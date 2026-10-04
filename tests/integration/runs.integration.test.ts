import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { WebSocket } from "ws";
import {
  TenantAccess,
  OrganizationService,
  ProjectService,
  EnvironmentService,
  CollectionService,
  TestDefinitionService,
  RunService,
} from "../../packages/db/src/index.js";
import {
  TenantEncryption,
  LocalKeyProvider,
  newToken,
  tokenHash,
} from "../../packages/security/src/index.js";
import { ExecutionProcessor } from "../../apps/worker/src/execution-processor.js";
import {
  createQueues,
  redisConnection,
  reconcileRuns,
  startQueueWorkers,
} from "../../apps/worker/src/queues.js";
import { createApp } from "../../apps/api/src/app.js";
import { attachLiveEvents } from "../../apps/api/src/live-events.js";
import { AuthService } from "../../apps/api/src/auth/service.js";
import {
  authConfigSchema,
  cookieNames,
} from "../../apps/api/src/auth/config.js";
import type { EngineResult } from "../../packages/test-engine/src/index.js";
import { ScheduleService } from "../../packages/db/src/services/schedule-service.js";
import { Scheduler } from "../../apps/worker/src/scheduler.js";

describe.skipIf(process.env.RUN_INTEGRATION !== "true")(
  "durable runs, queues and authenticated live events",
  () => {
    const schema = `monitorx_runs_test_${randomUUID().replaceAll("-", "")}`;
    const url = new URL(
      process.env.AUTH_TEST_DATABASE_URL ??
        "postgresql://monitorx:local_development_only@localhost:5432/monitorx",
    );
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      throw Error("Local test database required");
    url.searchParams.set("schema", schema);
    const db = new PrismaClient({ datasourceUrl: url.toString() });
    const encryption = new TenantEncryption(
      new LocalKeyProvider(1, { "1": randomBytes(32).toString("base64") }),
    );
    const access = new TenantAccess(db),
      runs = new RunService(access),
      tests = new TestDefinitionService(access);
    const userId = randomUUID(),
      token = newToken(),
      csrf = newToken();
    const context = { userId, organizationId: "", requestId: randomUUID() };
    let projectId: string,
      collectionId: string,
      environmentId: string,
      testId: string;
    const config = authConfigSchema.parse({}),
      auth = new AuthService(db, { async send() {} });
    const app = createApp("test", {
      service: auth,
      config,
      workspace: { encryption, mailer: { async sendInvitation() {} } },
    });
    const request = (
      method: "get" | "post" | "patch",
      path: string,
      body?: object,
    ) => {
      const client = supertest(app);
      const req = client[method](`/api/v1${path}`)
        .set("Origin", config.APP_BASE_URL)
        .set("X-Organization-Id", context.organizationId)
        .set("X-CSRF-Token", csrf)
        .set("Cookie", [
          `${cookieNames.access}=${token}`,
          `${cookieNames.csrf}=${csrf}`,
        ]);
      return body ? req.send(body) : req;
    };
    const result: EngineResult = {
      status: "PASSED",
      healthState: "HEALTHY",
      latencyMs: 12,
      httpStatus: 200,
      errorClass: null,
      errorMessage: null,
      responseBytes: 11,
      responsePreview: '{"ok":true}',
      requestMetadata: { method: "GET" },
      assertions: [
        {
          position: 0,
          type: "status",
          severity: "REQUIRED",
          expected: 200,
          actual: 200,
          passed: true,
          message: "Assertion passed.",
        },
      ],
    };
    beforeAll(async () => {
      const require = createRequire(
        new URL("../../packages/db/package.json", import.meta.url),
      );
      try {
        await promisify(execFile)(
          process.execPath,
          [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
          {
            cwd: new URL("../../packages/db", import.meta.url),
            env: { ...process.env, DATABASE_URL: url.toString() },
            timeout: 60000,
          },
        );
      } catch {
        throw Error("Could not initialize isolated run schema");
      }
      await db.user.create({
        data: {
          id: userId,
          email: "runner@example.test",
          displayName: "Runner",
          emailVerifiedAt: new Date(),
        },
      });
      await db.authSession.create({
        data: {
          userId,
          familyId: randomUUID(),
          accessHash: tokenHash(token),
          refreshHash: tokenHash(newToken()),
          accessExpiresAt: new Date(Date.now() + 3600000),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      context.organizationId = (
        await new OrganizationService(access).create(
          { userId, requestId: context.requestId },
          {
            name: "Runs",
            slug: "runs",
          },
        )
      ).id;
      projectId = (
        await new ProjectService(access).create(context, {
          name: "Project",
          slug: "project",
        })
      ).id;
      environmentId = (
        await new EnvironmentService(access, encryption).create(
          context,
          projectId,
          {
            name: "Test",
            slug: "test",
            variables: { BASE_URL: "https://example.test" },
          },
        )
      ).id;
      collectionId = (
        await new CollectionService(access).create(context, {
          projectId,
          name: "Checks",
        })
      ).id;
      testId = (
        await tests.create(context, {
          projectId,
          collectionId,
          environmentId,
          name: "Healthy",
          method: "GET",
          urlTemplate: "{{BASE_URL}}/health",
          assertions: [{ type: "status", expected: 200 }],
        })
      ).id;
    }, 70000);
    afterAll(async () => {
      await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await db.$disconnect();
    });
    it("returns 202 without a queue/network wait and freezes the configuration", async () => {
      const response = await request("post", `/tests/${testId}/run`, {
        environmentId,
      });
      expect(response.status).toBe(202);
      expect(response.body.status).toBe("QUEUED");
      expect(response.body.configSnapshot).toBeUndefined();
      const before = await db.apiTest.findUniqueOrThrow({
        where: { id: testId },
      });
      await tests.update(context, testId, {
        expectedRevision: before.revision,
        name: "Changed after enqueue",
      });
      const execute = vi.fn(async () => result);
      const processor = new ExecutionProcessor(db, encryption, execute);
      await Promise.all([
        processor.process(response.body.runId),
        processor.process(response.body.runId),
      ]);
      expect(execute).toHaveBeenCalledOnce();
      expect(execute.mock.calls[0]?.[0].definition.name).toBe("Healthy");
      const saved = await db.execution.findUniqueOrThrow({
        where: { id: response.body.runId },
        include: { assertionResults: true, events: true },
      });
      expect(saved.status).toBe("PASSED");
      expect(saved.configSnapshot).toBeNull();
      expect(saved.assertionResults).toHaveLength(1);
      expect(saved.events.map((e) => e.type)).toEqual([
        "execution.queued",
        "execution.started",
        "execution.completed",
      ]);
    });
    it("denies Viewer submission, cross-tenant polling and CSRF", async () => {
      await db.membership.updateMany({
        where: { userId },
        data: { role: "VIEWER" },
      });
      expect(
        (await request("post", `/tests/${testId}/run`, { environmentId }))
          .status,
      ).toBe(403);
      await db.membership.updateMany({
        where: { userId },
        data: { role: "OWNER" },
      });
      const run = await runs.submit(context, testId, { environmentId });
      expect(
        (
          await request("get", `/runs/${run.id}`).set(
            "X-Organization-Id",
            randomUUID(),
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request("post", `/runs/${run.id}/cancel`, {}).set(
            "X-CSRF-Token",
            "invalid",
          )
        ).status,
      ).toBe(403);
      await runs.cancel(context, run.id);
      expect((await runs.get(context, run.id)).status).toBe("CANCELLED");
    });
    it("rechecks membership before executing a queued request", async () => {
      const run = await runs.submit(context, testId, { environmentId });
      await db.membership.updateMany({
        where: { userId },
        data: { role: "VIEWER" },
      });
      const execute = vi.fn(async () => result);
      await new ExecutionProcessor(db, encryption, execute).process(run.id);
      expect(execute).not.toHaveBeenCalled();
      expect((await runs.get(context, run.id)).status).toBe("CANCELLED");
      await db.membership.updateMany({
        where: { userId },
        data: { role: "OWNER" },
      });
    });
    it("retries persistence, not a target failure; restart marks unknown rather than repeating HTTP", async () => {
      const run = await runs.submit(context, testId, { environmentId });
      const execute = vi.fn(async () => ({
        ...result,
        status: "FAILED" as const,
        healthState: "DOWN" as const,
        httpStatus: 500,
      }));
      const processor = new ExecutionProcessor(db, encryption, execute);
      const persist = vi.spyOn(processor, "persist");
      persist.mockRejectedValueOnce(Error("Temporary database fixture"));
      await processor.process(run.id);
      await processor.process(run.id);
      expect(execute).toHaveBeenCalledOnce();
      expect(persist).toHaveBeenCalledTimes(2);
      const interrupted = await runs.submit(context, testId, { environmentId });
      await db.execution.update({
        where: { id: interrupted.id },
        data: { status: "RUNNING", leaseUntil: new Date(0) },
      });
      await processor.recoverExpired();
      expect((await runs.get(context, interrupted.id)).healthState).toBe(
        "UNKNOWN",
      );
      expect(execute).toHaveBeenCalledOnce();
    });
    it("enforces collection parallelism and cancels queued children", async () => {
      await tests.create(context, {
        projectId,
        collectionId,
        environmentId,
        name: "Second",
        method: "GET",
        urlTemplate: "https://example.test",
      });
      const group = await runs.submitCollection(context, collectionId, {
        environmentId,
        parallelism: 1,
      });
      const children = (await runs.group(context, group.runId)).executions;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const execute = vi.fn(async () => {
        await barrier;
        return result;
      });
      const processor = new ExecutionProcessor(db, encryption, execute);
      const first = processor.process(children[0]!.id);
      await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
      await processor.process(children[1]!.id);
      expect(execute).toHaveBeenCalledOnce();
      await runs.cancel(context, group.runId, true);
      release();
      await first;
      expect(
        (await runs.group(context, group.runId)).executions.every(
          (e) => e.status === "CANCELLED",
        ),
      ).toBe(true);
    });
    it("uses real BullMQ and rebuilds lost disposable queues from PostgreSQL", async () => {
      const prefix = `monitorx-test-${randomUUID()}`;
      const connection = redisConnection("redis://localhost:6379");
      const queues = createQueues(connection, prefix);
      let workers: ReturnType<typeof startQueueWorkers> = [];
      try {
        const run = await runs.submit(context, testId, { environmentId });
        await reconcileRuns(db, queues);
        await reconcileRuns(db, queues);
        expect(await queues.execution.getWaitingCount()).toBe(1);
        await queues.execution.obliterate({ force: true }); // Exact random test namespace, never FLUSHDB.
        await reconcileRuns(db, queues);
        const execute = vi.fn(async () => result);
        workers = startQueueWorkers(
          db,
          queues,
          new ExecutionProcessor(db, encryption, execute),
          connection,
          prefix,
        );
        await vi.waitFor(
          async () =>
            expect((await runs.get(context, run.id)).status).toBe("PASSED"),
          { timeout: 10000 },
        );
        expect(execute).toHaveBeenCalledOnce();
        expect(
          await db.assertionResult.count({ where: { executionId: run.id } }),
        ).toBe(1);
      } finally {
        await Promise.all(workers.map((w) => w.close()));
        for (const q of Object.values(queues)) {
          await q.obliterate({ force: true });
          await q.close();
        }
      }
    }, 15000);
    it("authenticates live streams, delivers persisted events and revokes membership access", async () => {
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const gateway = attachLiveEvents(server, auth, config);
      const addr = server.address();
      if (!addr || typeof addr === "string") throw Error("Missing port");
      const endpoint = `ws://127.0.0.1:${addr.port}/api/v1/events?organizationId=${context.organizationId}`;
      const client = new WebSocket(endpoint, {
        origin: config.APP_BASE_URL,
        headers: { Cookie: `${cookieNames.access}=${token}` },
      });
      try {
        const received: string[] = [];
        client.on("message", (data) => received.push(String(data)));
        await new Promise<void>((resolve, reject) => {
          client.once("open", resolve);
          client.once("error", reject);
        });
        const run = await runs.submit(context, testId, { environmentId });
        await vi.waitFor(
          () =>
            expect(received.some((message) => message.includes(run.id))).toBe(
              true,
            ),
          { timeout: 4000 },
        );
        expect(
          received.some((message) =>
            /ciphertext|configSnapshot|accessHash/.test(message),
          ),
        ).toBe(false);
        await db.membership.updateMany({
          where: { userId },
          data: { status: "REMOVED" },
        });
        await vi.waitFor(
          () => expect(client.readyState).toBe(WebSocket.CLOSED),
          { timeout: 4000 },
        );
        await db.membership.updateMany({
          where: { userId },
          data: { status: "ACTIVE" },
        });
        await runs.cancel(context, run.id);
        const denied = new WebSocket(endpoint, {
          origin: "https://evil.example",
        });
        await new Promise<void>((resolve) => {
          denied.once("error", () => resolve());
        });
        denied.terminate();
      } finally {
        client.terminate();
        for (const socket of gateway.clients) socket.terminate();
        gateway.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }, 12000);
    it("validates schedule APIs and denies Viewer and foreign-tenant access", async () => {
      const created = await request("post", "/schedules", {
        testId,
        environmentId,
      });
      expect(created.status).toBe(201);
      expect(created.body.enabled).toBe(false);
      expect((await request("get", `/tests/${testId}/schedule`)).body.id).toBe(
        created.body.id,
      );
      expect(
        (
          await request("patch", `/schedules/${created.body.id}`, {
            paused: true,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request("get", `/tests/${testId}/schedule`).set(
            "X-Organization-Id",
            randomUUID(),
          )
        ).status,
      ).toBe(404);
      await db.membership.updateMany({
        where: { userId },
        data: { role: "VIEWER" },
      });
      expect(
        (
          await request("patch", `/schedules/${created.body.id}`, {
            enabled: true,
          })
        ).status,
      ).toBe(403);
      await db.membership.updateMany({
        where: { userId },
        data: { role: "OWNER" },
      });
      expect(
        (
          await request("patch", `/schedules/${created.body.id}`, {
            timeZone: "Invalid/Zone",
          })
        ).status,
      ).toBe(400);
    });
    it("reconciles schedules idempotently, rebuilds delayed jobs and cancels paused slots", async () => {
      const test = await tests.create(context, {
        projectId,
        collectionId,
        environmentId,
        name: "Scheduled",
        method: "GET",
        urlTemplate: "https://example.test",
        enabled: true,
      });
      const service = new ScheduleService(access);
      const schedule = await service.create(context, {
        testId: test.id,
        environmentId,
        enabled: true,
        intervalMinutes: 5,
      });
      const now = new Date(),
        slot = new Date(now.getTime() - 120000);
      await db.schedule.update({
        where: { id: schedule.id },
        data: { nextRunAt: slot },
      });
      const scheduler = new Scheduler(db);
      await Promise.all([
        scheduler.reconcile(now),
        new Scheduler(db).reconcile(now),
      ]);
      const rows = await db.execution.findMany({
        where: { testId: test.id, scheduledAt: slot },
      });
      expect(rows).toHaveLength(1);
      expect(scheduler.metrics.missed).toBeGreaterThanOrEqual(0);
      await expect(
        db.execution.create({
          data: {
            organizationId: context.organizationId,
            testId: test.id,
            scheduledAt: slot,
            runKind: "SCHEDULED",
          },
        }),
      ).rejects.toThrow();
      const prefix = `monitorx-schedule-test-${randomUUID()}`,
        queues = createQueues(
          redisConnection("redis://localhost:6379"),
          prefix,
        );
      try {
        await reconcileRuns(db, queues);
        expect(
          await queues.execution.getJob(rows[0]!.logicalKey!),
        ).toBeTruthy();
        await queues.execution.obliterate({ force: true });
        await reconcileRuns(db, queues);
        expect(
          await queues.execution.getJob(rows[0]!.logicalKey!),
        ).toBeTruthy();
      } finally {
        for (const queue of Object.values(queues)) {
          await queue.obliterate({ force: true });
          await queue.close();
        }
      }
      await service.update(context, schedule.id, { paused: true });
      expect((await runs.get(context, rows[0]!.id)).status).toBe("CANCELLED");
      expect((await service.get(context, test.id))?.nextRunAt).toBeNull();
      await service.update(context, schedule.id, { paused: false });
      expect((await service.get(context, test.id))?.nextRunAt).toBeInstanceOf(
        Date,
      );
      await service.update(context, schedule.id, { enabled: false });
    }, 15000);
    it("skips maintenance and rechecks schedule pause at worker admission", async () => {
      const test = await tests.create(context, {
        projectId,
        collectionId,
        environmentId,
        name: "Maintenance",
        method: "GET",
        urlTemplate: "https://example.test",
        enabled: true,
      });
      const now = new Date();
      const service = new ScheduleService(access);
      const schedule = await service.create(context, {
        testId: test.id,
        environmentId,
        enabled: true,
        maintenanceWindows: [
          {
            start: new Date(now.getTime() - 60000).toISOString(),
            end: new Date(now.getTime() + 600000).toISOString(),
          },
        ],
      });
      await db.schedule.update({
        where: { id: schedule.id },
        data: { nextRunAt: now },
      });
      await new Scheduler(db).reconcile(now);
      const row = await db.execution.findFirstOrThrow({
        where: { scheduleId: schedule.id },
      });
      expect(row.healthState).toBe("PAUSED");
      expect(row.status).toBe("CANCELLED");
      const manual = await runs.submit(context, test.id, { environmentId });
      await db.execution.update({
        where: { id: manual.id },
        data: { scheduleId: schedule.id, runKind: "SCHEDULED" },
      });
      const execute = vi.fn(async () => result);
      await new ExecutionProcessor(db, encryption, execute).process(manual.id);
      expect(execute).not.toHaveBeenCalled();
      expect((await runs.get(context, manual.id)).healthState).toBe("PAUSED");
      await service.update(context, schedule.id, { enabled: false });
    });
    it("shares concurrency limits across processors and reschedules rate-limited work", async () => {
      const one = await runs.submit(context, testId, { environmentId }),
        two = await runs.submit(context, testId, { environmentId });
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const execute = vi.fn(async () => {
        await barrier;
        return result;
      });
      const limits = { global: 1, organization: 1, host: 1 };
      const first = new ExecutionProcessor(
        db,
        encryption,
        execute,
        limits,
      ).process(one.id);
      await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
      await new ExecutionProcessor(db, encryption, execute, limits).process(
        two.id,
      );
      const deferred = await db.execution.findUniqueOrThrow({
        where: { id: two.id },
      });
      expect(deferred.status).toBe("QUEUED");
      expect(deferred.deferCount).toBe(1);
      expect(deferred.availableAt.getTime()).toBeGreaterThan(Date.now());
      release();
      await first;
      await db.organization.update({
        where: { id: context.organizationId },
        data: { executionRateLimitPerMinute: 1 },
      });
      await db.execution.update({
        where: { id: two.id },
        data: { availableAt: new Date(0) },
      });
      await new ExecutionProcessor(db, encryption, execute, limits).process(
        two.id,
      );
      expect(execute).toHaveBeenCalledOnce();
      await db.organization.update({
        where: { id: context.organizationId },
        data: { executionRateLimitPerMinute: null },
      });
      await db.execution.update({
        where: { id: two.id },
        data: { availableAt: new Date(0) },
      });
      await new ExecutionProcessor(db, encryption, execute, limits).process(
        two.id,
      );
      expect(execute).toHaveBeenCalledTimes(2);
    }, 15000);
    it("aggregates scheduled uptime separately, exact percentiles, health and incidents", async () => {
      const test = await tests.create(context, {
        projectId,
        collectionId,
        environmentId,
        name: "Metrics fixture",
        method: "GET",
        urlTemplate: "https://example.test",
        enabled: true,
        tags: ["metrics-fixture"],
      });
      const now = Date.now();
      for (const [i, healthState] of (
        ["HEALTHY", "DEGRADED", "DOWN", "UNKNOWN", "PAUSED"] as const
      ).entries()) {
        await db.execution.create({
          data: {
            organizationId: context.organizationId,
            testId: test.id,
            environmentId,
            runKind: "SCHEDULED",
            scheduledAt: new Date(now - 10000 + i),
            completedAt: new Date(now - 10000 + i),
            status:
              healthState === "PAUSED"
                ? "CANCELLED"
                : healthState === "HEALTHY" || healthState === "DEGRADED"
                  ? "PASSED"
                  : "FAILED",
            healthState,
            latencyMs:
              healthState === "PAUSED" || healthState === "UNKNOWN"
                ? null
                : (i + 1) * 100,
            errorClass: healthState === "DOWN" ? "assertion_failure" : null,
          },
        });
      }
      await db.execution.create({
        data: {
          organizationId: context.organizationId,
          testId: test.id,
          environmentId,
          runKind: "MANUAL",
          status: "PASSED",
          healthState: "HEALTHY",
          latencyMs: 400,
          completedAt: new Date(now - 1000),
        },
      });
      await db.incident.create({
        data: {
          organizationId: context.organizationId,
          testId: test.id,
          dedupeKey: "metrics-fixture",
        },
      });
      const response = await request(
        "get",
        `/tests/${test.id}/dashboard?range=24h`,
      );
      expect(response.status).toBe(200);
      expect(response.body.summary).toMatchObject({
        samples: 5,
        scheduledSamples: 3,
        passRate: 60,
        averageMs: 250,
        p50: 250,
        p95: 385,
        p99: 397,
      });
      expect(response.body.summary.uptime).toBeCloseTo(200 / 3);
      expect(response.body.health).toContainEqual({
        state: "HEALTHY",
        count: 1,
      });
      expect(response.body.errors).toEqual([
        { errorClass: "assertion_failure", count: 1 },
      ]);
      expect(response.body.openIncidents).toBe(1);
      expect(response.body.incidents[0].testName).toBe("Metrics fixture");
      expect(
        (
          await request(
            "get",
            `/collections/${collectionId}/dashboard?range=7d`,
          )
        ).status,
      ).toBe(200);
      expect(
        (await request("get", `/projects/${projectId}/dashboard?range=30d`))
          .status,
      ).toBe(200);
      await db.apiTest.update({
        where: { id: test.id },
        data: { enabled: false },
      });
      expect(
        (await request("get", `/tests/${test.id}/dashboard`)).body.health,
      ).toContainEqual({ state: "PAUSED", count: 1 });
      const empty = await tests.create(context, {
        projectId,
        collectionId,
        name: "Empty metrics",
        environmentId,
        method: "GET",
        urlTemplate: "https://example.test",
        enabled: true,
      });
      const noData = await request("get", `/tests/${empty.id}/dashboard`);
      expect(noData.body.summary.uptime).toBeNull();
      expect(noData.body.summary.passRate).toBeNull();
      expect(noData.body.health).toContainEqual({ state: "UNKNOWN", count: 1 });
    });
    it("paginates/filter histories, permits Viewer reads and rejects tenant leaks and invalid filters", async () => {
      const response = await request(
        "get",
        `/projects/${projectId}/executions?tag=metrics-fixture&runKind=SCHEDULED&limit=2&page=1`,
      );
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(5);
      expect(response.body.items).toHaveLength(2);
      const next = await request(
        "get",
        `/projects/${projectId}/executions?tag=metrics-fixture&runKind=SCHEDULED&limit=2&page=2`,
      );
      expect(next.body.items[0].id).not.toBe(response.body.items[0].id);
      expect(
        (
          await request(
            "get",
            `/collections/${collectionId}/executions?status=FAILED&tag=metrics-fixture&environmentId=${environmentId}`,
          )
        ).body.total,
      ).toBe(2);
      expect(
        (
          await request(
            "get",
            `/tests/${testId}/executions?from=2099-01-01T00:00:00.000Z`,
          )
        ).body.total,
      ).toBe(0);
      for (const query of [
        "limit=1000",
        "page=-1",
        "status=INVALID",
        "environmentId=wrong",
        "from=2026-10-04T00:00:00.000Z&to=2020-01-01T00:00:00.000Z",
        "unexpected=true",
      ])
        expect(
          (await request("get", `/tests/${testId}/executions?${query}`)).status,
        ).toBe(400);
      expect(
        (await request("get", `/tests/${testId}/dashboard?range=forever`))
          .status,
      ).toBe(400);
      expect(
        (await request("get", `/projects/${randomUUID()}/dashboard`)).status,
      ).toBe(404);
      expect(
        (
          await request("get", `/executions/${response.body.items[0].id}`).set(
            "X-Organization-Id",
            randomUUID(),
          )
        ).status,
      ).toBe(404);
      await db.membership.updateMany({
        where: { userId },
        data: { role: "VIEWER" },
      });
      try {
        expect(
          (await request("get", `/projects/${projectId}/dashboard`)).status,
        ).toBe(200);
        expect(
          (await request("get", `/executions/${response.body.items[0].id}`))
            .status,
        ).toBe(200);
      } finally {
        await db.membership.updateMany({
          where: { userId },
          data: { role: "OWNER" },
        });
      }
    });
    it("whitelists detail output and hides expired previews and metadata", async () => {
      const row = await db.execution.create({
        data: {
          organizationId: context.organizationId,
          testId,
          environmentId,
          status: "PASSED",
          completedAt: new Date(Date.now() - 8 * 86400000),
          createdAt: new Date(Date.now() - 8 * 86400000),
          configSnapshot: { internalOnly: "not-a-real-secret" },
          responsePreview: '{"ok":true}',
          requestMetadata: { method: "GET" },
          assertionResults: {
            create: {
              organizationId: context.organizationId,
              position: 0,
              type: "status",
              passed: true,
              actual: 200,
              expected: 200,
            },
          },
        },
      });
      const response = await request("get", `/executions/${row.id}`);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        previewExpired: true,
        responsePreview: null,
        requestMetadata: { method: "GET" },
      });
      expect(response.body.assertions[0]).toMatchObject({
        passed: true,
        actual: 200,
      });
      expect(response.body.configSnapshot).toBeUndefined();
      expect(response.body.organizationId).toBeUndefined();
      await db.execution.update({
        where: { id: row.id },
        data: { expiresAt: new Date(0) },
      });
      expect((await request("get", `/executions/${row.id}`)).status).toBe(404);
      expect(
        (await request("get", `/tests/${testId}/executions`)).body.items.some(
          (item: { id: string }) => item.id === row.id,
        ),
      ).toBe(false);
    });
  },
);
