import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Local onboarding only. No key is printed, no existing key is replaced, and no
// production environment is changed. Back up .env securely outside source control.
const target = new URL("../.env", import.meta.url);
try {
  const content = await readFile(target, "utf8");
  if (/^\s*TENANT_ENCRYPTION_KEYS\s*=/m.test(content)) {
    console.log("Encryption keys already configured; nothing changed.");
  } else if (
    /^\s*NODE_ENV\s*=\s*['"]?production/m.test(content) ||
    /^\s*TENANT_KEY_PROVIDER\s*=\s*['"]?kms/m.test(content)
  ) {
    console.error(
      "Local key setup is unavailable for production or KMS configuration.",
    );
    process.exitCode = 1;
  } else {
    const configuredVersion = content.match(
      /^\s*TENANT_ENCRYPTION_KEY_VERSION\s*=\s*['"]?(\d+)['"]?\s*$/m,
    );
    if (
      /^\s*TENANT_ENCRYPTION_KEY_VERSION\s*=/m.test(content) &&
      (!configuredVersion || !/^[1-9]\d{0,8}$/.test(configuredVersion[1]))
    )
      throw new Error("Invalid local key version");
    const version = configuredVersion?.[1] ?? "1";
    const additions = [];
    if (!/^\s*TENANT_KEY_PROVIDER\s*=/m.test(content))
      additions.push("TENANT_KEY_PROVIDER=local");
    if (!/^\s*TENANT_ENCRYPTION_KEY_VERSION\s*=/m.test(content))
      additions.push("TENANT_ENCRYPTION_KEY_VERSION=1");
    const keys = JSON.stringify({
      [version]: randomBytes(32).toString("base64"),
    });
    additions.push(`TENANT_ENCRYPTION_KEYS='${keys}'`);
    await writeFile(
      target,
      `${content.trimEnd()}\n\n${additions.join("\n")}\n`,
      { mode: 0o600 },
    );
    console.log(
      "Local encryption key saved privately in .env. Restart the API. Back up this file securely.",
    );
  }
} catch {
  console.error(
    "Local key setup failed. Ensure the root .env exists and is writable. No key values are logged.",
  );
  process.exitCode = 1;
}
