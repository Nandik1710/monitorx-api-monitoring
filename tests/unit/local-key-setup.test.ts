import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("initializes a private local key once, honors its version and refuses production", () => {
  const directory = mkdtempSync(join(tmpdir(), "monitorx-key-test-"));
  try {
    mkdirSync(join(directory, "scripts"));
    const script = join(directory, "scripts", "init-tenant-key.mjs");
    copyFileSync(resolve("scripts/init-tenant-key.mjs"), script);
    const env = join(directory, ".env");
    writeFileSync(
      env,
      "NODE_ENV=development\nTENANT_ENCRYPTION_KEY_VERSION=2\n",
    );
    const output = execFileSync(process.execPath, [script], {
      encoding: "utf8",
    });
    const saved = readFileSync(env, "utf8");
    const ring = JSON.parse(
      saved.match(/TENANT_ENCRYPTION_KEYS='(.*)'/)?.[1] ?? "{}",
    ) as Record<string, string>;
    expect(Object.keys(ring)).toEqual(["2"]);
    expect(Buffer.from(ring["2"] ?? "", "base64").length).toBe(32);
    expect(output.includes(ring["2"] ?? "missing")).toBe(false);
    execFileSync(process.execPath, [script], { stdio: "pipe" });
    expect(readFileSync(env, "utf8") === saved).toBe(true);
    for (const content of [
      "NODE_ENV=production\n",
      "TENANT_KEY_PROVIDER=kms\n",
      "TENANT_ENCRYPTION_KEY_VERSION=0\n",
    ]) {
      writeFileSync(env, content);
      expect(() =>
        execFileSync(process.execPath, [script], { stdio: "pipe" }),
      ).toThrow();
      expect(readFileSync(env, "utf8") === content).toBe(true);
    }
  } finally {
    // Only this test's unique OS temporary directory is removed.
    rmSync(directory, { recursive: true, force: true });
  }
});
