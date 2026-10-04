import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LocalKeyProvider,
  TenantEncryption,
} from "../../packages/security/src/encryption.js";
import { configureTenantEncryption } from "../../apps/api/src/workspaces/config.js";
import {
  variablesSchema,
  secretWriteSchema,
  inviteCreateSchema,
} from "../../packages/contracts/src/workspaces.js";
import {
  permits,
  canManageRole,
} from "../../packages/db/src/services/tenant-access.js";

describe("tenant encryption and RBAC primitives", () => {
  const keys = {
    "1": randomBytes(32).toString("base64"),
    "2": randomBytes(32).toString("base64"),
  };
  const binding = {
    organizationId: randomUUID(),
    environmentId: randomUUID(),
    name: "API_TOKEN",
  };
  const old = new TenantEncryption(new LocalKeyProvider(1, keys));
  const current = new TenantEncryption(new LocalKeyProvider(2, keys));
  it("encrypts randomly, authenticates context, and reads old key versions", async () => {
    const value = "fake-only-fixture-value";
    const first = await old.encrypt(value, binding);
    const second = await old.encrypt(value, binding);
    expect(first.ciphertext === second.ciphertext).toBe(false);
    expect(first.ciphertext.includes(value)).toBe(false);
    expect((await current.decrypt(first, binding)) === value).toBe(true);
    expect((await current.encrypt(value, binding)).keyVersion).toBe(2);
    for (const changed of [
      { ...binding, organizationId: randomUUID() },
      { ...binding, environmentId: randomUUID() },
      { ...binding, name: "OTHER" },
    ]) {
      await expect(current.decrypt(first, changed)).rejects.toThrow(
        "Secret encryption is unavailable.",
      );
    }
    await expect(
      current.decrypt({ ...first, keyVersion: 2 }, binding),
    ).rejects.toThrow();
    const envelope = JSON.parse(first.ciphertext) as { tag: string };
    envelope.tag = randomBytes(16).toString("base64");
    await expect(
      current.decrypt(
        { ...first, ciphertext: JSON.stringify(envelope) },
        binding,
      ),
    ).rejects.toThrow();
    await expect(
      new TenantEncryption(new LocalKeyProvider(2, { "2": keys["2"] })).decrypt(
        first,
        binding,
      ),
    ).rejects.toThrow();
  });
  it("fails closed for malformed ciphertext/configuration without leaking inputs", async () => {
    for (const ciphertext of [
      "local-fixture-ciphertext-v1",
      "{}",
      "null",
      "[]",
    ])
      await expect(
        old.decrypt({ ciphertext, keyVersion: 1 }, binding),
      ).rejects.toThrow("Secret encryption is unavailable.");
    expect(() => new LocalKeyProvider(1, { "1": "invalid-fixture" })).toThrow(
      "Secret encryption is unavailable.",
    );
    expect(() =>
      configureTenantEncryption({
        TENANT_ENCRYPTION_KEYS: "malformed-fixture",
      }),
    ).toThrow("Invalid tenant encryption configuration.");
    expect(() =>
      configureTenantEncryption({
        TENANT_KEY_PROVIDER: "kms",
        KMS_KEY_ID: "fixture-key-reference",
      }),
    ).toThrow();
    await expect(
      configureTenantEncryption({}).encrypt("fake", binding),
    ).rejects.toThrow();
  });
  it("uses the specification's role matrix and prevents admin promotion", () => {
    for (const role of ["OWNER", "ADMIN", "EDITOR", "VIEWER"] as const) {
      expect(permits(role, "read")).toBe(true);
      expect(permits(role, "manage")).toBe(["OWNER", "ADMIN"].includes(role));
      expect(permits(role, "owner")).toBe(role === "OWNER");
    }
    expect(canManageRole("ADMIN", "OWNER")).toBe(false);
    expect(canManageRole("ADMIN", "ADMIN")).toBe(false);
    expect(canManageRole("ADMIN", "EDITOR")).toBe(true);
  });
  it("bounds variables and rejects injected roles and secret fields", () => {
    expect(
      variablesSchema.safeParse({ BASE_URL: "https://example.test" }).success,
    ).toBe(true);
    expect(variablesSchema.safeParse({ constructor: "bad" }).success).toBe(
      false,
    );
    expect(
      variablesSchema.safeParse(
        Object.fromEntries(
          Array.from({ length: 101 }, (_, i) => [`KEY_${i}`, "fake"]),
        ),
      ).success,
    ).toBe(false);
    expect(
      secretWriteSchema.safeParse({
        value: "fake",
        organizationId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      inviteCreateSchema.safeParse({
        email: "fixture@example.test",
        role: "SUPERADMIN",
      }).success,
    ).toBe(false);
  });
});
