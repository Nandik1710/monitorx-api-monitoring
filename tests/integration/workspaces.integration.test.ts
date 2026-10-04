import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import supertest from "supertest";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  TenantAccess,
  OrganizationService,
  ProjectService,
  EnvironmentService,
  InvitationService,
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
  "workspace isolation and encrypted secrets",
  () => {
    const url = new URL(
      process.env.AUTH_TEST_DATABASE_URL ??
        "postgresql://monitorx:local_development_only@localhost:5432/monitorx",
    );
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      throw new Error("Tenant tests require a local database.");
    const schema = `monitorx_tenant_test_${randomUUID().replaceAll("-", "")}`;
    url.searchParams.set("schema", schema);
    const db = new PrismaClient({ datasourceUrl: url.toString() });
    const access = new TenantAccess(db);
    const organizations = new OrganizationService(access);
    const projects = new ProjectService(access);
    const keys = {
      "1": randomBytes(32).toString("base64"),
      "2": randomBytes(32).toString("base64"),
    };
    const encryption = new TenantEncryption(new LocalKeyProvider(1, keys));
    const environments = new EnvironmentService(access, encryption);
    const messages: Array<{
      email: string;
      organizationId: string;
      token: string;
    }> = [];
    const mailer = {
      async sendInvitation(
        email: string,
        organizationId: string,
        token: string,
      ) {
        messages.push({ email, organizationId, token });
      },
    };
    let now = new Date();
    const invitations = new InvitationService(access, mailer, () => now);
    const auth = new AuthService(db, { async send() {} });
    const config = authConfigSchema.parse({});
    const app = createApp("test", {
      service: auth,
      config,
      workspace: { encryption, mailer },
    });
    const users = Object.fromEntries(
      ["owner", "admin", "editor", "viewer", "outsider", "recipient"].map(
        (role) => [role, randomUUID()],
      ),
    ) as Record<
      "owner" | "admin" | "editor" | "viewer" | "outsider" | "recipient",
      string
    >;
    const tokens = new Map<string, string>();
    const csrf = newToken();
    let orgA = "";
    let orgB = "";
    let projectA = "";
    let projectB = "";
    let environmentA = "";
    let environmentB = "";
    const actor = (userId = users.owner) => ({
      userId,
      requestId: randomUUID(),
    });
    const ctx = (userId = users.owner, organizationId = orgA) => ({
      ...actor(userId),
      organizationId,
    });
    const fixture = { name: "Project", slug: "project" };
    function request(
      method: "get" | "post" | "patch" | "put" | "delete",
      path: string,
      userId = users.owner,
      organizationId: string | null = orgA,
      body?: object,
    ) {
      const client = supertest(app);
      let req = client[method](`/api/v1${path}`)
        .set("Origin", config.APP_BASE_URL)
        .set("X-CSRF-Token", csrf)
        .set("Cookie", [
          `${cookieNames.access}=${tokens.get(userId) ?? ""}`,
          `${cookieNames.csrf}=${csrf}`,
        ]);
      if (organizationId !== null)
        req = req.set("X-Organization-Id", organizationId);
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
      } catch {
        throw new Error(
          "Could not initialize the isolated tenancy database. Start local PostgreSQL and retry.",
        );
      }
    }, 70000);
    beforeEach(async () => {
      await db.organization.deleteMany();
      await db.authRateLimit.deleteMany();
      messages.length = 0;
      now = new Date();
      orgA = (
        await organizations.create(actor(), {
          name: "Workspace A",
          slug: "workspace-a",
        })
      ).id;
      orgB = (
        await organizations.create(actor(users.outsider), {
          name: "Workspace B",
          slug: "workspace-b",
        })
      ).id;
      for (const role of ["admin", "editor", "viewer"] as const)
        await db.membership.create({
          data: {
            organizationId: orgA,
            userId: users[role],
            role: role.toUpperCase() as "ADMIN" | "EDITOR" | "VIEWER",
            status: "ACTIVE",
            acceptedAt: new Date(),
          },
        });
      projectA = (await projects.create(ctx(), fixture)).id;
      projectB = (await projects.create(ctx(users.outsider, orgB), fixture)).id;
      environmentA = (
        await environments.create(ctx(), projectA, {
          name: "Development",
          slug: "development",
          variables: { BASE_URL: "https://example.test" },
        })
      ).id;
      environmentB = (
        await environments.create(ctx(users.outsider, orgB), projectB, {
          name: "Other",
          slug: "other",
        })
      ).id;
    });
    afterAll(async () => {
      if (!/^monitorx_tenant_test_[a-f0-9]{32}$/.test(schema))
        throw new Error("Unsafe test schema");
      try {
        await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await db.$disconnect();
      }
    });

    it("creates an owner-bound workspace and lists only active memberships", async () => {
      const created = await request(
        "post",
        "/organizations",
        users.owner,
        null,
        { name: "New", slug: "new-workspace" },
      );
      expect(created.status).toBe(201);
      expect(created.body.role).toBe("OWNER");
      const list = await request("get", "/organizations");
      expect(
        list.body.items.some((item: { id: string }) => item.id === orgB),
      ).toBe(false);
      expect(
        (
          await request("post", "/organizations", users.owner, null, {
            name: "Bad",
            slug: "bad",
            ownerUserId: users.outsider,
          })
        ).status,
      ).toBe(400);
      expect(
        (await request("get", "/projects", users.owner, null)).status,
      ).toBe(400);
      expect((await supertest(app).get("/api/v1/organizations")).status).toBe(
        401,
      );
      expect((await request("get", "/projects?limit=101")).status).toBe(400);
      expect(
        (await request("get", "/projects?limit=1&page=1")).body.items.length,
      ).toBe(1);
    });

    it.each(["owner", "admin", "editor", "viewer"] as const)(
      "enforces %s permissions in HTTP routes and direct services",
      async (role) => {
        const user = users[role];
        const allowed = role === "owner" || role === "admin";
        expect(
          (await request("get", `/environments/${environmentA}`, user)).status,
        ).toBe(200);
        expect(
          (await request("get", `/environments/${environmentA}/secrets`, user))
            .status,
        ).toBe(200);
        expect(
          (
            await request("post", "/projects", user, orgA, {
              name: "Created",
              slug: "created",
            })
          ).status,
        ).toBe(allowed ? 201 : 403);
        expect(
          (
            await request("patch", `/projects/${projectA}`, user, orgA, {
              name: "Updated",
            })
          ).status,
        ).toBe(allowed ? 200 : 403);
        expect(
          (
            await request(
              "post",
              `/projects/${projectA}/environments`,
              user,
              orgA,
              { name: "Staging", slug: "staging" },
            )
          ).status,
        ).toBe(allowed ? 201 : 403);
        expect(
          (
            await request(
              "patch",
              `/environments/${environmentA}`,
              user,
              orgA,
              { variables: { BASE_URL: "https://staging.example.test" } },
            )
          ).status,
        ).toBe(allowed ? 200 : 403);
        expect(
          (
            await request(
              "put",
              `/environments/${environmentA}/secrets/API_TOKEN`,
              user,
              orgA,
              { value: "fake-fixture-secret" },
            )
          ).status,
        ).toBe(allowed ? 200 : 403);
        expect(
          (await request("get", `/organizations/${orgA}/members`, user)).status,
        ).toBe(allowed ? 200 : 403);
        if (!allowed) {
          await expect(
            projects.create(ctx(user), { name: "Bypass", slug: "bypass" }),
          ).rejects.toMatchObject({ status: 403 });
          await expect(
            environments.writeSecret(ctx(user), environmentA, "TOKEN", {
              value: "fake",
            }),
          ).rejects.toMatchObject({ status: 403 });
          await expect(
            invitations.create(ctx(user), {
              email: "recipient@example.test",
              role: "VIEWER",
            }),
          ).rejects.toMatchObject({ status: 403 });
          await expect(
            organizations.changeRole(ctx(user), users.viewer, {
              role: "OWNER",
            }),
          ).rejects.toMatchObject({ status: 403 });
        }
      },
    );

    it("denies every foreign object read/write even with guessed identifiers and forged org headers", async () => {
      const cases: Array<
        ["get" | "post" | "patch" | "put" | "delete", string, object?]
      > = [
        ["get", `/projects/${projectB}`],
        ["patch", `/projects/${projectB}`, { name: "No" }],
        ["delete", `/projects/${projectB}`, {}],
        ["get", `/projects/${projectB}/environments`],
        [
          "post",
          `/projects/${projectB}/environments`,
          { name: "No", slug: "no" },
        ],
        ["get", `/environments/${environmentB}`],
        ["patch", `/environments/${environmentB}`, { name: "No" }],
        ["delete", `/environments/${environmentB}`, {}],
        ["get", `/environments/${environmentB}/secrets`],
        [
          "put",
          `/environments/${environmentB}/secrets/TOKEN`,
          { value: "fake" },
        ],
        ["delete", `/environments/${environmentB}/secrets/TOKEN`, {}],
        ["post", `/environments/${environmentB}/secrets/TOKEN/rotate`, {}],
        ["get", `/organizations/${orgB}`],
        ["get", `/organizations/${orgB}/members`],
        ["get", `/organizations/${orgB}/invites`],
        [
          "post",
          `/organizations/${orgB}/invites`,
          { email: "recipient@example.test", role: "VIEWER" },
        ],
        [
          "patch",
          `/organizations/${orgB}/members/${users.outsider}`,
          { role: "VIEWER" },
        ],
        ["delete", `/organizations/${orgB}/members/${users.outsider}`, {}],
      ];
      for (const [method, path, body] of cases) {
        expect(
          (await request(method, path, users.owner, orgA, body)).status,
        ).toBe(404);
        expect(
          (await request(method, path, users.owner, orgB, body)).status,
        ).toBe(404);
      }
      expect(
        (await request("post", "/projects", users.owner, orgB, fixture)).status,
      ).toBe(404);
      await expect(projects.get(ctx(), projectB)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        environments.update(ctx(), environmentB, { name: "No" }),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await projects.get(ctx(users.outsider, orgB), projectB)).name,
      ).toBe("Project");
    }, 20000);

    it("does not let multi-workspace membership mix objects across the selected workspace", async () => {
      await db.membership.create({
        data: {
          organizationId: orgB,
          userId: users.owner,
          role: "OWNER",
          status: "ACTIVE",
        },
      });
      expect(
        (
          await request(
            "get",
            `/environments/${environmentB}`,
            users.owner,
            orgA,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            "get",
            `/environments/${environmentB}`,
            users.owner,
            orgB,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            "post",
            `/projects/${projectB}/environments`,
            users.owner,
            orgA,
            { name: "No", slug: "no" },
          )
        ).status,
      ).toBe(404);
    });

    it("supports CRUD without cascaded destruction of nonempty projects or referenced environments", async () => {
      expect(
        (
          await request(
            "delete",
            `/projects/${projectA}`,
            users.owner,
            orgA,
            {},
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await request("patch", `/projects/${projectA}`, users.owner, orgA, {
            name: "Renamed",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            "patch",
            `/environments/${environmentA}`,
            users.owner,
            orgA,
            { name: "Renamed", variables: { REGION: "local" } },
          )
        ).status,
      ).toBe(200);
      expect(
        (await request("get", `/environments/${environmentA}`)).body.variables,
      ).toEqual({ REGION: "local" });
      expect(
        (
          await request(
            "delete",
            `/environments/${environmentA}`,
            users.owner,
            orgA,
            {},
          )
        ).status,
      ).toBe(204);
      expect(
        (
          await request(
            "delete",
            `/projects/${projectA}`,
            users.owner,
            orgA,
            {},
          )
        ).status,
      ).toBe(204);
      expect((await request("get", `/projects/${projectA}`)).status).toBe(404);
      expect(
        (await request("get", `/environments/${environmentA}`)).status,
      ).toBe(404);
    });

    it("stores only authenticated ciphertext, returns masked metadata and never audits secret values", async () => {
      const value = "fake-redaction-marker-do-not-display";
      const response = await request(
        "put",
        `/environments/${environmentA}/secrets/API_TOKEN`,
        users.owner,
        orgA,
        { value },
      );
      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual([
        "createdAt",
        "id",
        "key",
        "keyVersion",
        "maskedValue",
        "updatedAt",
      ]);
      expect(response.body.maskedValue).toBe("••••••••");
      const saved = await db.environmentSecret.findFirstOrThrow({
        where: {
          organizationId: orgA,
          environmentId: environmentA,
          key: "API_TOKEN",
        },
      });
      expect(saved.ciphertext.includes(value)).toBe(false);
      expect(
        (await encryption.decrypt(saved, {
          organizationId: orgA,
          environmentId: environmentA,
          name: "API_TOKEN",
        })) === value,
      ).toBe(true);
      for (const path of [
        `/environments/${environmentA}`,
        `/environments/${environmentA}/secrets`,
        `/projects/${projectA}/environments`,
      ]) {
        const result = await request("get", path);
        expect(
          JSON.stringify(result.body).includes(value) ||
            JSON.stringify(result.body).includes(saved.ciphertext),
        ).toBe(false);
      }
      const audits = await db.auditLog.findMany({
        where: { organizationId: orgA },
      });
      expect(
        JSON.stringify(audits).includes(value) ||
          JSON.stringify(audits).includes(saved.ciphertext),
      ).toBe(false);
      expect(audits.some((row) => row.action === "secret.created")).toBe(true);
      expect(
        (
          await request(
            "patch",
            `/environments/${environmentA}`,
            users.owner,
            orgA,
            { variables: { API_TOKEN: "fake" } },
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await request(
            "put",
            `/environments/${environmentA}/secrets/BASE_URL`,
            users.owner,
            orgA,
            { value },
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await request(
            "put",
            `/environments/${environmentA}/secrets/API_TOKEN`,
            users.owner,
            orgA,
            { value, ciphertext: "injected" },
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await request(
            "delete",
            `/environments/${environmentA}/secrets/API_TOKEN`,
            users.owner,
            orgA,
            {},
          )
        ).status,
      ).toBe(204);
      expect(
        await db.environmentSecret.count({
          where: { organizationId: orgA, environmentId: environmentA },
        }),
      ).toBe(0);
    });

    it("rotates encryption versions without exposing plaintext and rejects swapped ciphertext", async () => {
      await environments.writeSecret(ctx(), environmentA, "TOKEN", {
        value: "fake-rotation-fixture",
      });
      const current = new TenantEncryption(new LocalKeyProvider(2, keys));
      const upgraded = new EnvironmentService(access, current);
      expect(
        (await upgraded.rotateSecret(ctx(), environmentA, "TOKEN")).keyVersion,
      ).toBe(2);
      const saved = await db.environmentSecret.findFirstOrThrow({
        where: { organizationId: orgA, environmentId: environmentA },
      });
      expect(
        (await current.decrypt(saved, {
          organizationId: orgA,
          environmentId: environmentA,
          name: "TOKEN",
        })) === "fake-rotation-fixture",
      ).toBe(true);
      await db.environmentSecret.create({
        data: {
          organizationId: orgB,
          environmentId: environmentB,
          key: "TOKEN",
          ciphertext: saved.ciphertext,
          keyVersion: saved.keyVersion,
        },
      });
      await expect(
        upgraded.rotateSecret(ctx(users.outsider, orgB), environmentB, "TOKEN"),
      ).rejects.toThrow("Secret encryption is unavailable.");
    });

    it("rejects cross-tenant database relations independently of route checks", async () => {
      await expect(
        db.environment.create({
          data: {
            organizationId: orgA,
            projectId: projectB,
            name: "Invalid",
            slug: "invalid",
            variables: {},
          },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
      await expect(
        db.environmentSecret.create({
          data: {
            organizationId: orgA,
            environmentId: environmentB,
            key: "TOKEN",
            ciphertext: "invalid-fixture",
          },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
    });

    it("requires a verified matching recipient and a single-use, org-bound invitation", async () => {
      const created = await request(
        "post",
        `/organizations/${orgA}/invites`,
        users.admin,
        orgA,
        { email: "recipient@example.test", role: "EDITOR" },
      );
      expect(created.status).toBe(201);
      expect("tokenHash" in created.body || "token" in created.body).toBe(
        false,
      );
      const token = messages.at(-1)!.token;
      expect(
        (
          await db.organizationInvitation.findFirstOrThrow({
            where: { organizationId: orgA },
          })
        ).tokenHash === tokenHash(token),
      ).toBe(true);
      expect(
        (
          await request(
            "post",
            `/organizations/${orgA}/invites/accept`,
            users.outsider,
            null,
            { token },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            "post",
            `/organizations/${orgB}/invites/accept`,
            users.recipient,
            null,
            { token },
          )
        ).status,
      ).toBe(404);
      await db.user.update({
        where: { id: users.recipient },
        data: { emailVerifiedAt: null },
      });
      await expect(
        invitations.accept(actor(users.recipient), orgA, { token }),
      ).rejects.toMatchObject({ status: 401 });
      await db.user.update({
        where: { id: users.recipient },
        data: { emailVerifiedAt: new Date() },
      });
      expect(
        (
          await request(
            "post",
            `/organizations/${orgA}/invites/accept`,
            users.recipient,
            null,
            { token },
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            "post",
            `/organizations/${orgA}/invites/accept`,
            users.recipient,
            null,
            { token },
          )
        ).status,
      ).toBe(404);
      expect((await organizations.get(ctx(users.recipient))).role).toBe(
        "EDITOR",
      );
      expect(
        await db.auditLog.count({
          where: { organizationId: orgA, action: "invitation.accepted" },
        }),
      ).toBe(1);
    });

    it("expires, supersedes and revokes invitations; rechecks inviter authority", async () => {
      const input = { email: "recipient@example.test", role: "VIEWER" };
      await invitations.create(ctx(), input);
      const first = messages.at(-1)!.token;
      const second = await invitations.create(ctx(), input);
      const token = messages.at(-1)!.token;
      await expect(
        invitations.accept(actor(users.recipient), orgA, { token: first }),
      ).rejects.toMatchObject({ status: 404 });
      await invitations.revoke(ctx(), second.id);
      await expect(
        invitations.accept(actor(users.recipient), orgA, { token }),
      ).rejects.toMatchObject({ status: 404 });
      await invitations.create(ctx(users.admin), input);
      const pending = messages.at(-1)!.token;
      await organizations.changeRole(ctx(), users.admin, { role: "VIEWER" });
      await expect(
        invitations.accept(actor(users.recipient), orgA, { token: pending }),
      ).rejects.toMatchObject({ status: 404 });
      await invitations.create(ctx(), input);
      now = new Date(now.getTime() + 8 * 24 * 60 * 60_000);
      await expect(
        invitations.accept(actor(users.recipient), orgA, {
          token: messages.at(-1)!.token,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("prevents an admin from superseding or revoking a pending privileged invitation", async () => {
      const invitation = await invitations.create(ctx(), {
        email: "recipient@example.test",
        role: "OWNER",
      });
      const token = messages.at(-1)!.token;
      await expect(
        invitations.create(ctx(users.admin), {
          email: "recipient@example.test",
          role: "VIEWER",
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        invitations.revoke(ctx(users.admin), invitation.id),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (await invitations.accept(actor(users.recipient), orgA, { token }))
          .role,
      ).toBe("OWNER");
    });

    it("prevents owner/admin escalation, last-owner removal and stale membership reuse", async () => {
      for (const role of ["OWNER", "ADMIN"] as const) {
        expect(
          (
            await request(
              "post",
              `/organizations/${orgA}/invites`,
              users.admin,
              orgA,
              { email: "recipient@example.test", role },
            )
          ).status,
        ).toBe(403);
        await expect(
          organizations.changeRole(ctx(users.admin), users.viewer, { role }),
        ).rejects.toMatchObject({ status: 403 });
      }
      await expect(
        organizations.changeRole(ctx(users.admin), users.owner, {
          role: "VIEWER",
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        organizations.removeMember(ctx(), users.owner),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        organizations.changeRole(ctx(), users.owner, { role: "ADMIN" }),
      ).rejects.toMatchObject({ status: 409 });
      await organizations.changeRole(ctx(), users.admin, { role: "VIEWER" });
      expect(
        (
          await request("post", "/projects", users.admin, orgA, {
            name: "No",
            slug: "no",
          })
        ).status,
      ).toBe(403);
      await organizations.removeMember(ctx(), users.admin);
      expect((await request("get", "/projects", users.admin)).status).toBe(404);
      await db.membership.updateMany({
        where: { organizationId: orgA, userId: users.viewer },
        data: { status: "SUSPENDED" },
      });
      expect((await request("get", "/projects", users.viewer)).status).toBe(
        404,
      );
    });

    it("protects concurrent last-owner changes and invitation acceptance", async () => {
      await organizations.changeRole(ctx(), users.admin, { role: "OWNER" });
      const changes = await Promise.allSettled([
        organizations.changeRole(ctx(), users.owner, { role: "VIEWER" }),
        organizations.changeRole(ctx(users.admin), users.admin, {
          role: "VIEWER",
        }),
      ]);
      expect(
        changes.filter((result) => result.status === "fulfilled").length,
      ).toBe(1);
      expect(
        await db.membership.count({
          where: { organizationId: orgA, role: "OWNER", status: "ACTIVE" },
        }),
      ).toBe(1);
      const owner = await db.membership.findFirstOrThrow({
        where: { organizationId: orgA, role: "OWNER", status: "ACTIVE" },
      });
      await invitations.create(ctx(owner.userId), {
        email: "recipient@example.test",
        role: "VIEWER",
      });
      const token = messages.at(-1)!.token;
      const results = await Promise.allSettled([
        invitations.accept(actor(users.recipient), orgA, { token }),
        invitations.accept(actor(users.recipient), orgA, { token }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled").length,
      ).toBe(1);
    }, 20000);

    it("protects all workspace mutations with origin/CSRF and returns sanitized errors", async () => {
      const noCsrf = await supertest(app)
        .post("/api/v1/projects")
        .set("Cookie", `${cookieNames.access}=${tokens.get(users.owner)}`)
        .send(fixture);
      expect(noCsrf.status).toBe(403);
      const hostile = await request(
        "post",
        "/projects",
        users.owner,
        orgA,
        fixture,
      ).set("Origin", "https://hostile.example");
      expect(hostile.status).toBe(403);
      expect(hostile.headers["access-control-allow-origin"]).toBeUndefined();
      const duplicate = await request(
        "post",
        "/projects",
        users.owner,
        orgA,
        fixture,
      );
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe("CONFLICT");
      expect(JSON.stringify(duplicate.body).includes("Prisma")).toBe(false);
    });

    it("revokes undelivered invitations and fails secret writes without keys", async () => {
      const failing = new InvitationService(access, {
        async sendInvitation() {
          throw new Error("private-fixture-error");
        },
      });
      await expect(
        failing.create(ctx(), {
          email: "recipient@example.test",
          role: "VIEWER",
        }),
      ).rejects.toMatchObject({ status: 503 });
      expect(
        await db.organizationInvitation.count({
          where: { organizationId: orgA, revokedAt: null },
        }),
      ).toBe(0);
      const noKey = new EnvironmentService(
        access,
        new TenantEncryption({
          currentVersion: 1,
          async getKey() {
            throw new Error("private-key-error");
          },
        }),
      );
      await expect(
        noKey.writeSecret(ctx(), environmentA, "TOKEN", { value: "fake" }),
      ).rejects.toThrow("Secret encryption is unavailable.");
      expect(
        await db.environmentSecret.count({ where: { organizationId: orgA } }),
      ).toBe(0);
    });
  },
);
