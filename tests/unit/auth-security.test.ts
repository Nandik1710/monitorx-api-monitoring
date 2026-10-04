import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
  newToken,
  tokenHash,
  equalTokens,
} from "../../packages/security/src/auth.js";
import {
  registerSchema,
  resetPasswordSchema,
  authErrorResponseSchema,
} from "../../packages/contracts/src/auth.js";
import { authConfigSchema } from "../../apps/api/src/auth/config.js";

describe("authentication primitives and contracts", () => {
  it("salts passwords, verifies them, and safely handles absent or corrupt hashes", async () => {
    const value = "only-a-fake-test-password";
    const one = await hashPassword(value);
    const two = await hashPassword(value);
    expect(one === two).toBe(false);
    expect(one.includes(value)).toBe(false);
    expect(await verifyPassword(value, one)).toBe(true);
    expect(await verifyPassword("incorrect", one)).toBe(false);
    expect(await verifyPassword(value, null)).toBe(false);
    expect(await verifyPassword(value, "corrupt")).toBe(false);
  }, 15000);
  it("uses unpredictable tokens and one-way digests", () => {
    const a = newToken();
    const b = newToken();
    expect(a.length).toBe(43);
    expect(a === b).toBe(false);
    expect(tokenHash(a).length).toBe(64);
    expect(equalTokens(a, a)).toBe(true);
    expect(equalTokens(a, b)).toBe(false);
  });
  it("normalizes emails, rejects weak passwords and unrecognized fields", () => {
    const input = {
      email: " TEST@EXAMPLE.COM ",
      password: "fake-test-password",
      displayName: "Test",
    };
    expect(registerSchema.parse(input).email).toBe("test@example.com");
    expect(
      registerSchema.safeParse({ ...input, password: "short" }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...input, organizationId: "injected" })
        .success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({
        token: "invalid",
        password: input.password,
      }).success,
    ).toBe(false);
    expect(
      authErrorResponseSchema.safeParse({
        error: {
          code: "AUTHENTICATION_FAILED",
          message: "Unable to authenticate.",
          requestId: "test",
        },
      }).success,
    ).toBe(true);
  });
  it("keeps OAuth opt-in and requires explicit configuration", () => {
    expect(
      authConfigSchema.safeParse({ APP_BASE_URL: "malformed" }).success,
    ).toBe(false);
    expect(
      authConfigSchema.safeParse({ MAILPIT_SMTP_URL: "malformed" }).success,
    ).toBe(false);
    expect(authConfigSchema.parse({}).GITHUB_OAUTH_ENABLED).toBe(false);
    expect(
      authConfigSchema.safeParse({ GITHUB_OAUTH_ENABLED: "true" }).success,
    ).toBe(false);
    expect(
      authConfigSchema.safeParse({ APP_BASE_URL: "http://example.com" })
        .success,
    ).toBe(false);
    expect(
      authConfigSchema.safeParse({ APP_BASE_URL: "https://example.com/path" })
        .success,
    ).toBe(false);
    expect(
      authConfigSchema.safeParse({ MAILPIT_SMTP_URL: "https://example.com" })
        .success,
    ).toBe(false);
  });
});
