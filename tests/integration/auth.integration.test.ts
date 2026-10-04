import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "../../apps/api/src/auth/service.js";
import {
  authConfigSchema,
  cookieNames,
} from "../../apps/api/src/auth/config.js";
import { createApp } from "../../apps/api/src/app.js";
import { rateLimit } from "../../apps/api/src/auth/rate-limit.js";
import {
  newToken,
  tokenHash,
  verifyPassword,
} from "../../packages/security/src/auth.js";

const enabled = process.env.RUN_INTEGRATION === "true";
describe.skipIf(!enabled)("authentication against migrated PostgreSQL", () => {
  const url = new URL(
    process.env.AUTH_TEST_DATABASE_URL ??
      "postgresql://monitorx:local_development_only@localhost:5432/monitorx",
  );
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("Auth integration tests require a local database.");
  const schema = `monitorx_auth_test_${randomUUID().replaceAll("-", "")}`;
  url.searchParams.set("schema", schema);
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  const messages: Array<{ to: string; purpose: string; token: string }> = [];
  let now = new Date();
  const config = authConfigSchema.parse({});
  const mailer = {
    async send(to: string, purpose: string, token: string) {
      messages.push({ to, purpose, token });
    },
  };
  const service = new AuthService(db, mailer, () => now);
  const app = createApp("test", { service, config });
  const input = {
    email: "alice@example.test",
    displayName: "Alice",
    password: "fake-long-password-for-tests",
  };
  const id = () => randomUUID();
  const csrf = newToken();
  function post(path: string, body: object, cookies: string[] = []) {
    return supertest(app)
      .post(`/api/v1/auth/${path}`)
      .set("Origin", config.APP_BASE_URL)
      .set("X-CSRF-Token", csrf)
      .set("Cookie", [`${cookieNames.csrf}=${csrf}`, ...cookies])
      .send(body);
  }
  function cookies(response: { headers: Record<string, unknown> }): string[] {
    return ((response.headers["set-cookie"] as string[]) ?? []).map(
      (value) => value.split(";")[0]!,
    );
  }
  async function registered(): Promise<void> {
    await service.register(input, id());
  }
  async function verified(): Promise<void> {
    await registered();
    await service.consumeEmail(messages.at(-1)!.token, "VERIFY_EMAIL", id());
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
          timeout: 60_000,
        },
      );
      await db.$connect();
    } catch {
      throw new Error(
        "Could not migrate the isolated local auth test schema. Start PostgreSQL and retry.",
      );
    }
  }, 70000);
  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.authSession.deleteMany();
    await db.authToken.deleteMany();
    await db.user.deleteMany();
    await db.authRateLimit.deleteMany();
    await db.oAuthAttempt.deleteMany();
    messages.length = 0;
    now = new Date();
  });
  afterAll(async () => {
    // Exact random schema created by this suite only; never reset a shared database.
    if (!/^monitorx_auth_test_[a-f0-9]{32}$/.test(schema))
      throw new Error("Unsafe test schema");
    try {
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await db.$disconnect();
    }
  });

  it("registers, verifies once, logs in, keeps secrets hashed, and audits", async () => {
    expect((await post("register", input)).status).toBe(202);
    const user = await db.user.findUniqueOrThrow({
      where: { email: input.email },
    });
    expect(await verifyPassword(input.password, user.passwordHash)).toBe(true);
    expect(
      (await post("login", { email: input.email, password: input.password }))
        .status,
    ).toBe(401);
    const token = messages[0]!.token;
    const record = await db.authToken.findFirstOrThrow();
    expect(record.tokenHash === tokenHash(token)).toBe(true);
    expect((await post("verify-email", { token })).status).toBe(200);
    expect((await post("verify-email", { token })).status).toBe(400);
    const login = await post("login", {
      email: input.email,
      password: input.password,
    });
    expect(login.status).toBe(200);
    expect(Object.keys(login.body.user).sort()).toEqual([
      "displayName",
      "email",
      "emailVerified",
      "id",
    ]);
    const headers = login.headers["set-cookie"] as unknown as string[];
    expect(
      headers.every(
        (value) =>
          value.includes("Secure") &&
          value.includes("HttpOnly") &&
          value.includes("SameSite=Lax") &&
          value.includes("Path=/") &&
          !value.includes("Domain="),
      ),
    ).toBe(true);
    expect(
      (
        await supertest(app)
          .get("/api/v1/auth/me")
          .set("Cookie", cookies(login))
      ).status,
    ).toBe(200);
    expect((await post("logout", {}, cookies(login))).status).toBe(204);
    expect(
      (
        await supertest(app)
          .get("/api/v1/auth/me")
          .set("Cookie", cookies(login))
      ).status,
    ).toBe(401);
    const audits = await db.auditLog.findMany();
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "auth.registered",
        "auth.email_verified",
        "auth.login_succeeded",
        "auth.logged_out",
      ]),
    );
    expect(
      audits.every(
        (row) => row.metadata === null && row.organizationId === null,
      ),
    ).toBe(true);
    const serialized = JSON.stringify(audits);
    expect(
      serialized.includes(input.password) ||
        serialized.includes(token) ||
        serialized.includes(input.email),
    ).toBe(false);
  }, 15000);

  it("returns the same response for unknown accounts, duplicates and bad credentials", async () => {
    const original = await post("register", input);
    expect((await post("register", input)).body).toEqual(original.body);
    const known = await post("forgot-password", { email: input.email });
    expect(
      (await post("forgot-password", { email: "missing@example.test" })).body,
    ).toEqual(known.body);
    const wrong = await post("login", {
      email: input.email,
      password: "incorrect",
    });
    const missing = await post("login", {
      email: "missing@example.test",
      password: "incorrect",
    });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.error.code).toBe(missing.body.error.code);
    expect(wrong.body.error.message).toBe(missing.body.error.message);
  }, 15000);

  it("rotates refresh tokens and revokes the entire family on reuse", async () => {
    await verified();
    const first = await service.login(input.email, input.password, id());
    const second = await service.refresh(first.refresh, id());
    expect(second.refresh === first.refresh).toBe(false);
    expect(second.expiresAt.getTime()).toBe(first.expiresAt.getTime());
    await expect(service.authenticate(first.access)).rejects.toMatchObject({
      status: 401,
    });
    expect((await service.authenticate(second.access)).email).toBe(input.email);
    await expect(service.refresh(first.refresh, id())).rejects.toMatchObject({
      status: 401,
    });
    await expect(service.authenticate(second.access)).rejects.toMatchObject({
      status: 401,
    });
    expect(await db.authSession.count({ where: { revokedAt: null } })).toBe(0);
    expect(
      await db.auditLog.count({
        where: { action: "auth.refresh_reuse_detected" },
      }),
    ).toBe(1);
  });

  it("serializes concurrent refreshes and single-use email links", async () => {
    await registered();
    const results = await Promise.allSettled([
      service.consumeEmail(messages[0]!.token, "VERIFY_EMAIL", id()),
      service.consumeEmail(messages[0]!.token, "VERIFY_EMAIL", id()),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled").length,
    ).toBe(1);
    const session = await service.login(input.email, input.password, id());
    const refreshes = await Promise.allSettled([
      service.refresh(session.refresh, id()),
      service.refresh(session.refresh, id()),
    ]);
    expect(
      refreshes.filter((result) => result.status === "fulfilled").length,
    ).toBe(1);
    const rejection = refreshes.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(
      rejection.reason.code === "AUTHENTICATION_FAILED"
        ? "AUTHENTICATION_FAILED"
        : (rejection.reason.meta?.error ?? rejection.reason.code),
    ).toBe("AUTHENTICATION_FAILED");
    expect(await db.authSession.count({ where: { revokedAt: null } })).toBe(0);
  }, 20000);

  it("rejects expired access, refresh, verification and reset tokens", async () => {
    await registered();
    const verification = messages[0]!.token;
    now = new Date(now.getTime() + 25 * 60 * 60_000);
    await expect(
      service.consumeEmail(verification, "VERIFY_EMAIL", id()),
    ).rejects.toMatchObject({ status: 400 });
    await service.requestEmail(input.email, "VERIFY_EMAIL", id());
    await service.consumeEmail(messages.at(-1)!.token, "VERIFY_EMAIL", id());
    const session = await service.login(input.email, input.password, id());
    await service.requestEmail(input.email, "RESET_PASSWORD", id());
    now = new Date(now.getTime() + 31 * 60_000);
    await expect(service.authenticate(session.access)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      service.consumeEmail(
        messages.at(-1)!.token,
        "RESET_PASSWORD",
        id(),
        "another-fake-test-password",
      ),
    ).rejects.toMatchObject({ status: 400 });
    now = new Date(now.getTime() + 8 * 24 * 60 * 60_000);
    await expect(service.refresh(session.refresh, id())).rejects.toMatchObject({
      status: 401,
    });
  });

  it("resets a password once, invalidates all sessions and supersedes old email links", async () => {
    await verified();
    const session = await service.login(input.email, input.password, id());
    await service.requestEmail(input.email, "RESET_PASSWORD", id());
    const old = messages.at(-1)!.token;
    await service.requestEmail(input.email, "RESET_PASSWORD", id());
    const token = messages.at(-1)!.token;
    await expect(
      service.consumeEmail(
        old,
        "RESET_PASSWORD",
        id(),
        "fake-replacement-password",
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.consumeEmail(token, "VERIFY_EMAIL", id()),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (
        await post("reset-password", {
          token,
          password: "fake-replacement-password",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post("reset-password", {
          token,
          password: "fake-replacement-password",
        })
      ).status,
    ).toBe(400);
    await expect(service.authenticate(session.access)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      service.login(input.email, input.password, id()),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (await service.login(input.email, "fake-replacement-password", id())).user
        .emailVerified,
    ).toBe(true);
    expect(
      await db.auditLog.count({ where: { action: "auth.password_reset" } }),
    ).toBe(1);
  }, 15000);

  it("applies persistent escalating backoff without revealing account existence", async () => {
    await verified();
    for (let i = 0; i < 5; i++)
      await expect(
        service.login(input.email, "incorrect", id()),
      ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.login(input.email, input.password, id()),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (
        await db.user.findUniqueOrThrow({ where: { email: input.email } })
      ).lockedUntil?.getTime(),
    ).toBe(now.getTime() + 60_000);
    now = new Date(now.getTime() + 61_000);
    await expect(
      service.login(input.email, "incorrect", id()),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (
        await db.user.findUniqueOrThrow({ where: { email: input.email } })
      ).lockedUntil?.getTime(),
    ).toBe(now.getTime() + 120_000);
    now = new Date(now.getTime() + 121_000);
    await service.login(input.email, input.password, id());
    expect(
      (await db.user.findUniqueOrThrow({ where: { email: input.email } }))
        .failedLoginCount,
    ).toBe(0);
  }, 20000);

  it("rejects disabled and administratively locked accounts", async () => {
    await verified();
    const session = await service.login(input.email, input.password, id());
    for (const status of ["DISABLED", "LOCKED"] as const) {
      await db.user.update({ where: { email: input.email }, data: { status } });
      await expect(
        service.login(input.email, input.password, id()),
      ).rejects.toMatchObject({ status: 401 });
      await expect(service.authenticate(session.access)).rejects.toMatchObject({
        status: 401,
      });
      await expect(
        service.refresh(session.refresh, id()),
      ).rejects.toMatchObject({ status: 401 });
    }
  });

  it("enforces CSRF, exact Origin, CORS, JSON, and strict validation", async () => {
    const csrfResponse = await supertest(app)
      .get("/api/v1/auth/csrf")
      .set("Origin", config.APP_BASE_URL);
    expect(csrfResponse.status).toBe(200);
    expect(csrfResponse.headers["access-control-allow-origin"]).toBe(
      config.APP_BASE_URL,
    );
    const missing = await supertest(app).post("/api/v1/auth/login").send({});
    expect(missing.status).toBe(403);
    const hostile = await supertest(app)
      .post("/api/v1/auth/login")
      .set("Origin", "https://hostile.example")
      .set("X-CSRF-Token", csrf)
      .set("Cookie", `${cookieNames.csrf}=${csrf}`)
      .send({});
    expect(hostile.status).toBe(403);
    expect(hostile.headers["access-control-allow-origin"]).toBeUndefined();
    const forged = await supertest(app)
      .post("/api/v1/auth/login")
      .set("Origin", config.APP_BASE_URL)
      .set("X-CSRF-Token", newToken())
      .set("Cookie", `${cookieNames.csrf}=${csrf}`)
      .send({});
    expect(forged.status).toBe(403);
    expect((await post("register", { ...input, admin: true })).status).toBe(
      400,
    );
    const form = await supertest(app)
      .post("/api/v1/auth/login")
      .set("Origin", config.APP_BASE_URL)
      .set("X-CSRF-Token", csrf)
      .set("Cookie", `${cookieNames.csrf}=${csrf}`)
      .type("form")
      .send({ email: input.email });
    expect(form.status).toBe(415);
    const malformed = await supertest(app)
      .post("/api/v1/auth/login")
      .type("json")
      .send("{");
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("VALIDATION_ERROR");
    expect(
      await db.auditLog.count({ where: { action: "auth.csrf_rejected" } }),
    ).toBe(3);
  });

  it("shares rate limits between service instances and renews expired windows", async () => {
    const bucket = `test:${id()}`;
    const replica = new PrismaClient({ datasourceUrl: url.toString() });
    try {
      await replica.$connect();
      const outcomes = await Promise.allSettled(
        Array.from({ length: 6 }, (_, index) =>
          rateLimit(index % 2 ? replica : db, bucket, 5, id(), now),
        ),
      );
      expect(
        outcomes.filter((result) => result.status === "fulfilled").length,
      ).toBe(5);
    } finally {
      await replica.$disconnect();
    }
    await rateLimit(db, bucket, 5, id(), new Date(now.getTime() + 16 * 60_000));
    for (let i = 0; i < 5; i++)
      expect(
        (await post("forgot-password", { email: input.email })).status,
      ).toBe(202);
    const limited = await post("forgot-password", { email: input.email });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("900");
  }, 15000);

  it("does not disclose SMTP failures or change generic registration responses", async () => {
    const failing = new AuthService(db, {
      async send() {
        throw new Error("private transport failure");
      },
    });
    await failing.register(input, id());
    expect(
      await db.auditLog.count({
        where: { action: "auth.email_delivery_failed" },
      }),
    ).toBe(1);
    expect(await db.user.count()).toBe(1);
  });

  it("keeps GitHub disabled by default and binds enabled callbacks to single-use browser state", async () => {
    expect((await supertest(app).get("/api/v1/auth/github")).status).toBe(404);
    let exchanges = 0;
    const oauthApp = createApp("test", {
      service,
      config: { ...config, GITHUB_OAUTH_ENABLED: true },
      provider: {
        authorize(state) {
          return `https://github.com/login/oauth/authorize?state=${state}`;
        },
        async exchange() {
          exchanges++;
          return {
            id: "12345",
            email: "github@example.test",
            name: "GitHub Fixture",
          };
        },
      },
    });
    const begin = await supertest(oauthApp).get("/api/v1/auth/github");
    const state = new URL(begin.headers.location!).searchParams.get("state")!;
    const callback = `/api/v1/auth/github/callback?state=${state}&code=fake-code`;
    expect((await supertest(oauthApp).get(callback)).status).toBe(401);
    const response = await supertest(oauthApp)
      .get(callback)
      .set("Cookie", cookies(begin));
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(config.APP_BASE_URL);
    expect(
      (await supertest(oauthApp).get(callback).set("Cookie", cookies(begin)))
        .status,
    ).toBe(401);
    expect(exchanges).toBe(1);
    expect(await db.user.count({ where: { githubId: "12345" } })).toBe(1);
    const again = await supertest(oauthApp).get("/api/v1/auth/github");
    await db.oAuthAttempt.updateMany({ data: { expiresAt: new Date(0) } });
    const expired = new URL(again.headers.location!).searchParams.get("state")!;
    expect(
      (
        await supertest(oauthApp)
          .get(`/api/v1/auth/github/callback?state=${expired}&code=fake`)
          .set("Cookie", cookies(again))
      ).status,
    ).toBe(401);
  });

  it("does not auto-link a password account with a matching GitHub email", async () => {
    await verified();
    await expect(
      service.githubLogin(
        { id: "54321", email: input.email, name: "Fixture" },
        id(),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (await db.user.findUniqueOrThrow({ where: { email: input.email } }))
        .githubId,
    ).toBeNull();
  });
});
