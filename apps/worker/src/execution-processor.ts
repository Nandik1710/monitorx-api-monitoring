import { Prisma, type PrismaClient } from "@prisma/client";
import { executionSnapshotSchema, inMaintenance } from "@monitorx/contracts";
import { createHash } from "node:crypto";
import { executionEvent } from "@monitorx/db";
import type { TenantEncryption } from "@monitorx/security";
import {
  executeTest,
  normalizeRequest,
  type EngineResult,
} from "@monitorx/test-engine";

export class ExecutionProcessor {
  constructor(
    readonly db: PrismaClient,
    private readonly encryption: TenantEncryption,
    private readonly execute: typeof executeTest = executeTest,
    private readonly limits = { global: 20, organization: 3, host: 2 },
  ) {}
  async process(id: string): Promise<void> {
    const row = await this.db.$transaction(
      async (tx) => {
        // Shared database admission lock makes limits effective across worker processes.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(73422)::text`;
        const scope = await tx.execution.findUnique({
          where: { id },
          select: { organizationId: true },
        });
        if (!scope) return null;
        await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id"=${scope.organizationId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "Execution" WHERE "id"=${id}::uuid FOR UPDATE`;
        const candidate = await tx.execution.findUnique({
          where: { id },
          include: { test: { include: { project: true } }, schedule: true },
        });
        if (
          !candidate ||
          candidate.status !== "QUEUED" ||
          candidate.availableAt > new Date()
        )
          return null;
        if (candidate.collectionRunId) {
          await tx.$queryRaw`SELECT "id" FROM "CollectionRun" WHERE "id"=${candidate.collectionRunId}::uuid FOR UPDATE`;
          const group = await tx.collectionRun.findUniqueOrThrow({
            where: { id: candidate.collectionRunId },
          });
          const active = await tx.execution.count({
            where: { collectionRunId: group.id, status: "RUNNING" },
          });
          if (active >= group.parallelism) {
            await tx.execution.update({
              where: { id },
              data: { availableAt: new Date(Date.now() + 1000) },
            });
            return null;
          }
        }
        const member = candidate.requestedById
          ? await tx.membership.findFirst({
              where: {
                organizationId: candidate.organizationId,
                userId: candidate.requestedById,
                status: "ACTIVE",
                role: { in: ["OWNER", "ADMIN", "EDITOR"] },
                user: { status: "ACTIVE", emailVerifiedAt: { not: null } },
              },
            })
          : null;
        const schedulePaused =
          candidate.runKind === "SCHEDULED" &&
          (!candidate.schedule ||
            !candidate.schedule.enabled ||
            candidate.schedule.pausedAt !== null ||
            !candidate.test.enabled ||
            inMaintenance(candidate.schedule.maintenanceWindows, new Date()));
        if (
          !member ||
          schedulePaused ||
          candidate.cancelRequested ||
          candidate.test.organizationId !== candidate.organizationId ||
          candidate.test.project.archivedAt
        ) {
          await tx.execution.update({
            where: { id },
            data: {
              status: "CANCELLED",
              healthState: schedulePaused ? "PAUSED" : "UNKNOWN",
              completedAt: new Date(),
              configSnapshot: Prisma.DbNull,
            },
          });
          await executionEvent(
            tx,
            candidate.organizationId,
            id,
            "execution.completed",
          );
          return null;
        }
        let targetHostHash = createHash("sha256")
          .update("invalid")
          .digest("hex");
        try {
          const snapshot = executionSnapshotSchema.parse(
            candidate.configSnapshot,
          );
          const secrets: Record<string, string> = {};
          for (const secret of snapshot.secrets)
            secrets[secret.key] = await this.encryption.decrypt(secret, {
              organizationId: candidate.organizationId,
              environmentId: candidate.environmentId!,
              name: secret.key,
            });
          targetHostHash = createHash("sha256")
            .update(
              normalizeRequest({
                definition: snapshot.definition,
                variables: snapshot.variables,
                secrets,
              }).url.hostname.toLowerCase(),
            )
            .digest("hex");
          for (const name of Object.keys(secrets)) delete secrets[name];
        } catch {
          /* Engine will record a bounded configuration failure without contacting a target. */
        }
        const active = {
          status: "RUNNING" as const,
          leaseUntil: { gt: new Date() },
        };
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: candidate.organizationId },
        });
        const rate = organization.executionRateLimitPerMinute;
        const rateReached =
          rate !== null &&
          (await tx.execution.count({
            where: {
              organizationId: candidate.organizationId,
              startedAt: { gte: new Date(Date.now() - 60000) },
            },
          })) >= rate;
        if (
          (await tx.execution.count({ where: active })) >= this.limits.global ||
          (await tx.execution.count({
            where: { ...active, organizationId: candidate.organizationId },
          })) >= this.limits.organization ||
          (await tx.execution.count({
            where: { ...active, targetHostHash },
          })) >= this.limits.host ||
          rateReached
        ) {
          const delay =
            Math.min(30000, 1000 * 2 ** Math.min(candidate.deferCount, 5)) +
            Math.floor(Math.random() * 500);
          await tx.execution.update({
            where: { id },
            data: {
              availableAt: new Date(Date.now() + delay),
              deferCount: { increment: 1 },
              targetHostHash,
            },
          });
          return null;
        }
        const claimed = await tx.execution.update({
          where: { id },
          data: {
            status: "RUNNING",
            startedAt: new Date(),
            leaseUntil: new Date(Date.now() + 90000),
            targetHostHash,
          },
        });
        await executionEvent(
          tx,
          candidate.organizationId,
          id,
          "execution.started",
        );
        return claimed;
      },
      { maxWait: 10000, timeout: 15000 },
    );
    if (!row) return;
    const controller = new AbortController();
    let polling = false;
    const poll = setInterval(() => {
      if (polling) return;
      polling = true;
      void this.db.execution
        .findUnique({ where: { id }, select: { cancelRequested: true } })
        .then((state) => {
          if (!state || state.cancelRequested) controller.abort();
        })
        .catch(() => controller.abort())
        .finally(() => {
          polling = false;
        });
    }, 250);
    const secrets: Record<string, string> = {};
    let result: EngineResult;
    try {
      const snapshot = executionSnapshotSchema.parse(row.configSnapshot);
      if (
        !row.environmentId ||
        snapshot.definition.environmentId !== row.environmentId
      )
        throw Error("Invalid snapshot");
      for (const secret of snapshot.secrets)
        secrets[secret.key] = await this.encryption.decrypt(secret, {
          organizationId: row.organizationId,
          environmentId: row.environmentId,
          name: secret.key,
        });
      result = await this.execute(
        {
          definition: snapshot.definition,
          variables: snapshot.variables,
          secrets,
        },
        { signal: controller.signal },
      );
    } catch {
      result = {
        status: "FAILED",
        healthState: "UNKNOWN",
        latencyMs: 0,
        httpStatus: null,
        responseBytes: 0,
        responsePreview: null,
        requestMetadata: {},
        assertions: [],
        errorClass: "configuration_error",
        errorMessage: "Execution configuration unavailable.",
      };
    } finally {
      clearInterval(poll);
      for (const name of Object.keys(secrets)) delete secrets[name];
    }
    // Retry persistence of the SAME result, never a second target request.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.persist(id, result);
        return;
      } catch {
        if (attempt >= 3) throw Error("Execution persistence unavailable.");
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(2000, 200 * 2 ** attempt) +
              Math.floor(Math.random() * 100),
          ),
        );
      }
    }
  }
  async persist(id: string, result: EngineResult): Promise<void> {
    await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Execution" WHERE "id"=${id}::uuid FOR UPDATE`;
        const row = await tx.execution.findUnique({ where: { id } });
        if (!row || row.status !== "RUNNING") return;
        const cancelled = row.cancelRequested || result.status === "CANCELLED";
        await tx.execution.update({
          where: { id },
          data: {
            status: cancelled ? "CANCELLED" : result.status,
            healthState: cancelled ? "UNKNOWN" : result.healthState,
            latencyMs: result.latencyMs,
            httpStatus: result.httpStatus,
            errorClass: cancelled ? "cancelled" : result.errorClass,
            errorMessage: result.errorMessage,
            responseBytes: result.responseBytes,
            responsePreview: result.responsePreview,
            requestMetadata: result.requestMetadata as Prisma.InputJsonValue,
            completedAt: new Date(),
            leaseUntil: null,
            configSnapshot: Prisma.DbNull,
          },
        });
        if (!cancelled)
          await tx.assertionResult.createMany({
            data: result.assertions.map((a) => ({
              organizationId: row.organizationId,
              executionId: id,
              position: a.position,
              type: a.type,
              severity: a.severity,
              passed: a.passed,
              expected:
                a.expected === null
                  ? Prisma.JsonNull
                  : (a.expected as Prisma.InputJsonValue),
              actual:
                a.actual === null
                  ? Prisma.JsonNull
                  : (a.actual as Prisma.InputJsonValue),
              message: a.message,
            })),
          });
        await executionEvent(tx, row.organizationId, id, "execution.completed");
      },
      { maxWait: 10000, timeout: 15000 },
    );
  }
  async recoverExpired(now = new Date()): Promise<void> {
    const rows = await this.db.execution.findMany({
      where: { status: "RUNNING", leaseUntil: { lt: now } },
      take: 100,
      select: { id: true },
    });
    for (const row of rows)
      await this.persist(row.id, {
        status: "FAILED",
        healthState: "UNKNOWN",
        latencyMs: 0,
        httpStatus: null,
        responseBytes: 0,
        responsePreview: null,
        requestMetadata: {},
        assertions: [],
        errorClass: "network_error",
        errorMessage:
          "Worker interrupted; target outcome is unknown. No automatic target retry was made.",
      });
  }
}
