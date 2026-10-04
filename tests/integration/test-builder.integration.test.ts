import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { createServer } from "node:http";
import supertest from "supertest";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  TenantAccess,
  OrganizationService,
  ProjectService,
  EnvironmentService,
  CollectionService,
  TestDefinitionService,
} from "../../packages/db/src/index.js";
import {
  TenantEncryption,
  LocalKeyProvider,
  newToken,
  tokenHash,
} from "../../packages/security/src/index.js";
import { createApp } from "../../apps/api/src/app.js";
import { AuthService } from "../../apps/api/src/auth/service.js";
import {
  authConfigSchema,
  cookieNames,
} from "../../apps/api/src/auth/config.js";

describe.skipIf(process.env.RUN_INTEGRATION !== "true")(
  "test builder data and API",
  () => {
    const schema = `monitorx_builder_test_${randomUUID().replaceAll("-", "")}`;
    const url = new URL(
      process.env.AUTH_TEST_DATABASE_URL ??
        "postgresql://monitorx:local_development_only@localhost:5432/monitorx",
    );
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      throw Error("Builder tests require a local database.");
    url.searchParams.set("schema", schema);
    const db = new PrismaClient({ datasourceUrl: url.toString() });
    const access = new TenantAccess(db),
      organizations = new OrganizationService(access),
      projects = new ProjectService(access);
    const encryption = new TenantEncryption(
      new LocalKeyProvider(1, { "1": randomBytes(32).toString("base64") }),
    );
    const environments = new EnvironmentService(access, encryption),
      collections = new CollectionService(access),
      tests = new TestDefinitionService(access);
    const auth = new AuthService(db, { async send() {} }),
      config = authConfigSchema.parse({});
    const app = createApp("test", {
      service: auth,
      config,
      workspace: { encryption, mailer: { async sendInvitation() {} } },
    });
    const users = {
      owner: randomUUID(),
      admin: randomUUID(),
      editor: randomUUID(),
      viewer: randomUUID(),
      outsider: randomUUID(),
    };
    const tokens = new Map<string, string>(),
      csrf = newToken();
    let org = "",
      foreignOrg = "",
      project = "",
      foreignProject = "",
      environment = "",
      foreignEnvironment = "",
      collection = "",
      foreignCollection = "";
    const actor = (userId = users.owner) => ({
      userId,
      requestId: randomUUID(),
    });
    const ctx = (userId = users.owner, organizationId = org) => ({
      ...actor(userId),
      organizationId,
    });
    const definition = () => ({
      projectId: project,
      collectionId: collection,
      environmentId: environment,
      name: "Health",
      method: "GET",
      urlTemplate: "{{BASE_URL}}/health",
      assertions: [{ type: "status", expected: 200 }],
      tags: ["smoke"],
    });
    function request(
      method: "get" | "post" | "patch" | "delete",
      path: string,
      body?: object,
      userId = users.owner,
      organizationId = org,
    ) {
      const client = supertest(app);
      const req = client[method](`/api/v1${path}`)
        .set("Origin", config.APP_BASE_URL)
        .set("X-Organization-Id", organizationId)
        .set("X-CSRF-Token", csrf)
        .set("Cookie", [
          `${cookieNames.csrf}=${csrf}`,
          `${cookieNames.access}=${tokens.get(userId) ?? ""}`,
        ]);
      return body === undefined ? req : req.send(body);
    }
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
        throw Error(
          "Could not initialize isolated builder database; start local PostgreSQL.",
        );
      }
      for (const [role, id] of Object.entries(users)) {
        await db.user.create({
          data: {
            id,
            email: `${role}@example.test`,
            displayName: role,
            emailVerifiedAt: new Date(),
          },
        });
        const token = newToken();
        tokens.set(id, token);
        await db.authSession.create({
          data: {
            userId: id,
            familyId: randomUUID(),
            accessHash: tokenHash(token),
            refreshHash: tokenHash(newToken()),
            accessExpiresAt: new Date(Date.now() + 3600000),
            expiresAt: new Date(Date.now() + 3600000),
          },
        });
      }
    }, 70000);
    beforeEach(async () => {
      await db.organization.deleteMany();
      await db.authRateLimit.deleteMany();
      org = (
        await organizations.create(actor(), { name: "A", slug: "builder-a" })
      ).id;
      foreignOrg = (
        await organizations.create(actor(users.outsider), {
          name: "B",
          slug: "builder-b",
        })
      ).id;
      for (const role of ["admin", "editor", "viewer"] as const)
        await db.membership.create({
          data: {
            organizationId: org,
            userId: users[role],
            role: role.toUpperCase() as "ADMIN" | "EDITOR" | "VIEWER",
            status: "ACTIVE",
          },
        });
      project = (await projects.create(ctx(), { name: "A", slug: "project-a" }))
        .id;
      foreignProject = (
        await projects.create(ctx(users.outsider, foreignOrg), {
          name: "B",
          slug: "project-b",
        })
      ).id;
      environment = (
        await environments.create(ctx(), project, {
          name: "Dev",
          slug: "dev",
          variables: { BASE_URL: "https://example.test" },
        })
      ).id;
      foreignEnvironment = (
        await environments.create(
          ctx(users.outsider, foreignOrg),
          foreignProject,
          { name: "Dev", slug: "dev" },
        )
      ).id;
      collection = (
        await collections.create(ctx(), { projectId: project, name: "Checks" })
      ).id;
      foreignCollection = (
        await collections.create(ctx(users.outsider, foreignOrg), {
          projectId: foreignProject,
          name: "Checks",
        })
      ).id;
    });
    afterAll(async () => {
      if (!/^monitorx_builder_test_[a-f0-9]{32}$/.test(schema))
        throw Error("Unsafe schema");
      try {
        await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await db.$disconnect();
      }
    });
    it("creates, reads, updates and deletes collections with pagination and audit records", async () => {
      const result = await request("post", "/collections", {
        projectId: project,
        name: "Second",
        description: "smoke suite",
      });
      expect(result.status).toBe(201);
      expect(
        (await request("get", `/collections/${result.body.id}`)).status,
      ).toBe(200);
      expect(
        (
          await request("patch", `/collections/${result.body.id}`, {
            name: "Renamed",
          })
        ).body.name,
      ).toBe("Renamed");
      const page = await request(
        "get",
        `/collections?projectId=${project}&limit=1&page=2`,
      );
      expect(page.body.items).toHaveLength(1);
      expect(page.body.total).toBe(2);
      expect(
        (await request("delete", `/collections/${result.body.id}`, {})).status,
      ).toBe(204);
      expect(
        (await request("get", `/collections/${result.body.id}`)).status,
      ).toBe(404);
      expect(
        (
          await db.auditLog.findMany({
            where: { organizationId: org, entityId: result.body.id },
          })
        ).map((x) => x.action),
      ).toEqual(
        expect.arrayContaining([
          "collection.created",
          "collection.updated",
          "collection.deleted",
        ]),
      );
    });
    it.each(["owner", "admin", "editor", "viewer"] as const)(
      "enforces %s access through routes and service calls",
      async (role) => {
        const allowed = role !== "viewer",
          user = users[role];
        expect(
          (await request("get", `/collections/${collection}`, undefined, user))
            .status,
        ).toBe(200);
        const created = await request("post", "/tests", definition(), user);
        expect(created.status).toBe(allowed ? 201 : 403);
        expect(
          (
            await request(
              "post",
              "/collections",
              { projectId: project, name: "Role collection" },
              user,
            )
          ).status,
        ).toBe(allowed ? 201 : 403);
        const saved = allowed
          ? created.body
          : await tests.create(ctx(), definition());
        expect(
          (await request("get", `/tests/${saved.id}`, undefined, user)).status,
        ).toBe(200);
        expect(
          (
            await request(
              "patch",
              `/tests/${saved.id}`,
              { expectedRevision: 1, name: "Changed" },
              user,
            )
          ).status,
        ).toBe(allowed ? 200 : 403);
        expect(
          (
            await request(
              "delete",
              `/tests/${saved.id}`,
              { expectedRevision: 2 },
              user,
            )
          ).status,
        ).toBe(allowed ? 204 : 403);
        if (!allowed) {
          await expect(
            tests.create(ctx(user), definition()),
          ).rejects.toMatchObject({ status: 403 });
          await expect(
            collections.remove(ctx(user), collection),
          ).rejects.toMatchObject({ status: 403 });
        }
        if (role === "editor")
          await expect(
            projects.update(ctx(user), project, { name: "Admin only" }),
          ).rejects.toMatchObject({ status: 403 });
      },
    );
    it("rejects foreign IDs, forged organization headers and same-tenant cross-project relations", async () => {
      const foreignTest = await tests.create(ctx(users.outsider, foreignOrg), {
        ...definition(),
        projectId: foreignProject,
        collectionId: foreignCollection,
        environmentId: foreignEnvironment,
        urlTemplate: "https://example.test",
      });
      const cases: Array<
        ["get" | "post" | "patch" | "delete", string, object?]
      > = [
        ["get", `/collections/${foreignCollection}`],
        ["patch", `/collections/${foreignCollection}`, { name: "Bad" }],
        ["delete", `/collections/${foreignCollection}`, {}],
        ["get", `/collections?projectId=${foreignProject}`],
        ["get", `/tests?collectionId=${foreignCollection}`],
        ["get", `/tests/${foreignTest.id}`],
        [
          "patch",
          `/tests/${foreignTest.id}`,
          { expectedRevision: 1, name: "Bad" },
        ],
        ["delete", `/tests/${foreignTest.id}`, { expectedRevision: 1 }],
        [
          "post",
          "/tests",
          { ...definition(), environmentId: foreignEnvironment },
        ],
        [
          "post",
          "/tests",
          { ...definition(), collectionId: foreignCollection },
        ],
        [
          "post",
          "/tests/preview",
          { ...definition(), environmentId: foreignEnvironment },
        ],
      ];
      for (const [method, path, body] of cases)
        for (const organizationId of [org, foreignOrg])
          expect(
            (await request(method, path, body, users.owner, organizationId))
              .status,
          ).toBe(404);
      await db.membership.create({
        data: {
          organizationId: foreignOrg,
          userId: users.owner,
          role: "OWNER",
          status: "ACTIVE",
        },
      });
      expect(
        (
          await request("post", "/tests", {
            ...definition(),
            collectionId: foreignCollection,
          })
        ).status,
      ).toBe(404);
      const second = (
        await projects.create(ctx(), { name: "Other", slug: "other" })
      ).id;
      const other = (
        await environments.create(ctx(), second, {
          name: "Other",
          slug: "other",
        })
      ).id;
      expect(
        (
          await request("post", "/tests", {
            ...definition(),
            environmentId: other,
          })
        ).status,
      ).toBe(404);
      await expect(tests.get(ctx(), foreignTest.id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        db.apiTest.create({
          data: {
            ...definition(),
            organizationId: org,
            environmentId: foreignEnvironment,
            queryRows: [],
            headerRows: [],
            assertions: [],
          },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
    }, 20000);
    it("saves every configuration field, advances revisions, rejects stale edits and records changed fields only", async () => {
      await environments.writeSecret(ctx(), environment, "TOKEN", {
        value: "fake-audit-marker",
      });
      const input = {
        ...definition(),
        method: "POST",
        queryRows: [{ key: "page", value: "1", enabled: false }],
        headerRows: [{ key: "Accept", value: "application/json" }],
        bodyMode: "JSON",
        bodyTemplate: '{"name":"fixture"}',
        authConfig: { type: "BEARER", token: "{{TOKEN}}" },
        followRedirects: true,
        maxRedirects: 2,
        enabled: true,
      };
      const result = await request("post", "/tests", input);
      expect(result.status).toBe(201);
      expect(result.body.revision).toBe(1);
      expect(result.body.authConfig).toEqual(input.authConfig);
      const id = result.body.id;
      const updated = await request("patch", `/tests/${id}`, {
        expectedRevision: 1,
        urlTemplate: "{{BASE_URL}}/v2",
        assertions: [{ type: "latency", expected: 500, severity: "WARNING" }],
      });
      expect(updated.status).toBe(200);
      expect(updated.body.revision).toBe(2);
      expect(
        (
          await request("patch", `/tests/${id}`, {
            expectedRevision: 1,
            name: "Stale",
          })
        ).status,
      ).toBe(409);
      expect(
        (await request("get", `/tests?collectionId=${collection}`)).body.items,
      ).toHaveLength(1);
      const audit = await db.auditLog.findFirstOrThrow({
        where: { organizationId: org, entityId: id, action: "test.updated" },
      });
      expect(audit.metadata).toEqual({
        revision: 2,
        changedFields: ["urlTemplate", "assertions"],
      });
      expect(
        JSON.stringify(audit).includes("fake-audit-marker") ||
          JSON.stringify(audit).includes("/v2"),
      ).toBe(false);
      const concurrent = await Promise.all([
        request("patch", `/tests/${id}`, { expectedRevision: 2, name: "One" }),
        request("patch", `/tests/${id}`, { expectedRevision: 2, name: "Two" }),
      ]);
      expect(concurrent.map((x) => x.status).sort()).toEqual([200, 409]);
    });
    it("previews substitution without decrypting secrets and rejects missing/public credential references", async () => {
      await environments.writeSecret(ctx(), environment, "TOKEN", {
        value: "fake-preview-plaintext-marker",
      });
      // Corrupt ciphertext still previews safely: only secret names are selected.
      await db.environmentSecret.updateMany({
        where: { organizationId: org, environmentId: environment },
        data: { ciphertext: "invalid-envelope" },
      });
      const input = {
        ...definition(),
        authConfig: { type: "BEARER", token: "{{TOKEN}}" },
        headerRows: [{ key: "X-Token", value: "{{TOKEN}}", sensitive: true }],
      };
      const response = await request(
        "post",
        "/tests/preview",
        input,
        users.viewer,
      );
      expect(response.status).toBe(200);
      expect(response.body.url).toBe("https://example.test/health");
      expect(response.body.auth.token).toBe("••••••••");
      expect(response.body.secretNames).toEqual(["TOKEN"]);
      expect(
        JSON.stringify(response.body).includes(
          "fake-preview-plaintext-marker",
        ) || JSON.stringify(response.body).includes("invalid-envelope"),
      ).toBe(false);
      expect(
        (
          await request("post", "/tests", {
            ...input,
            authConfig: { type: "BEARER", token: "{{BASE_URL}}" },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request("post", "/tests", {
            ...definition(),
            urlTemplate: "{{MISSING}}/health",
          })
        ).status,
      ).toBe(400);
      const bad = await request("post", "/tests", {
        ...definition(),
        authConfig: { type: "BEARER", token: "fake-private-input-marker" },
      });
      expect(bad.status).toBe(400);
      expect(
        JSON.stringify(bad.body).includes("fake-private-input-marker"),
      ).toBe(false);
    });
    it("rejects oversized expanded previews without echoing variable values", async () => {
      await db.environment.update({
        where: { id: environment },
        data: {
          variables: {
            BASE_URL: "https://example.test",
            BIG: "x".repeat(10000),
          },
        },
      });
      const response = await request("post", "/tests/preview", {
        ...definition(),
        method: "POST",
        bodyMode: "RAW",
        bodyTemplate: "{{BIG}}".repeat(30),
      });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain(
        "Expanded preview exceeds",
      );
      expect(JSON.stringify(response.body).includes("x".repeat(100))).toBe(
        false,
      );
      expect(await db.apiTest.count({ where: { organizationId: org } })).toBe(
        0,
      );
    });
    it("enforces workspace timeout, strict mutations and CSRF without altering existing data", async () => {
      await db.organization.update({
        where: { id: org },
        data: { testTimeoutLimitMs: 5000 },
      });
      expect((await request("post", "/tests", definition())).status).toBe(400);
      const valid = { ...definition(), timeoutMs: 5000 };
      expect(
        (
          await request("post", "/tests", {
            ...valid,
            organizationId: foreignOrg,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request("post", "/tests", valid).set(
            "Origin",
            "https://evil.example",
          )
        ).status,
      ).toBe(403);
      expect(
        (await request("post", "/tests", valid).set("X-CSRF-Token", "wrong"))
          .status,
      ).toBe(403);
      expect(
        (await request("post", "/tests", valid).set("Cookie", "")).status,
      ).toBe(401);
      expect(
        (await request("get", `/tests?collectionId=${collection}&limit=101`))
          .status,
      ).toBe(400);
      expect(await db.apiTest.count({ where: { organizationId: org } })).toBe(
        0,
      );
    });
    it("protects nonempty collections and execution history from deletion", async () => {
      const saved = await tests.create(ctx(), definition());
      expect(
        (await request("delete", `/collections/${collection}`, {})).status,
      ).toBe(409);
      await db.execution.create({
        data: {
          organizationId: org,
          testId: saved.id,
          environmentId: environment,
        },
      });
      expect(
        (await request("delete", `/tests/${saved.id}`, { expectedRevision: 1 }))
          .status,
      ).toBe(409);
      expect(
        (
          await request("patch", `/tests/${saved.id}`, {
            expectedRevision: 1,
            enabled: false,
          })
        ).status,
      ).toBe(200);
      expect(
        await db.execution.count({
          where: { organizationId: org, testId: saved.id },
        }),
      ).toBe(1);
    });
    it("never sends an outbound monitored request when saving, reading or previewing", async () => {
      let hits = 0;
      const target = createServer((_req, res) => {
        hits++;
        res.end("fixture");
      });
      await new Promise<void>((resolve) =>
        target.listen(0, "127.0.0.1", resolve),
      );
      try {
        const address = target.address();
        if (!address || typeof address === "string")
          throw Error("Missing fixture port");
        const input = {
          ...definition(),
          urlTemplate: `http://127.0.0.1:${address.port}/health`,
        };
        const saved = await request("post", "/tests", input);
        expect(saved.status).toBe(201);
        expect((await request("post", "/tests/preview", input)).status).toBe(
          200,
        );
        expect((await request("get", `/tests/${saved.body.id}`)).status).toBe(
          200,
        );
        expect(
          (await request("post", `/tests/${saved.body.id}/run`, {})).status,
        ).toBe(400);
        expect(hits).toBe(0);
        expect(
          await db.execution.count({ where: { organizationId: org } }),
        ).toBe(0);
      } finally {
        await new Promise<void>((resolve, reject) =>
          target.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
  },
);
