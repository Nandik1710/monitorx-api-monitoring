import {
  LocalKeyProvider,
  TenantEncryption,
  EncryptionError,
  type KeyProvider,
} from "./encryption.js";

export function configureTenantEncryption(
  env: Record<string, string | undefined>,
  deploymentProvider?: KeyProvider,
): TenantEncryption {
  try {
    const provider = env["TENANT_KEY_PROVIDER"] ?? "local";
    const namespace =
      env["TENANT_ENCRYPTION_CONTEXT"] ?? "monitorx:environment-secret";
    if (provider === "kms") {
      if (!env["KMS_KEY_ID"] || !deploymentProvider)
        throw new EncryptionError();
      return new TenantEncryption(deploymentProvider, namespace);
    }
    if (provider !== "local") throw new EncryptionError();
    const encoded = env["TENANT_ENCRYPTION_KEYS"];
    if (!encoded)
      return new TenantEncryption(
        {
          currentVersion: 1,
          async getKey() {
            throw new EncryptionError();
          },
        },
        namespace,
      );
    const parsed: unknown = JSON.parse(encoded);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Object.values(parsed).every((v) => typeof v === "string")
    )
      throw new EncryptionError();
    return new TenantEncryption(
      new LocalKeyProvider(
        Number(env["TENANT_ENCRYPTION_KEY_VERSION"] ?? "1"),
        parsed as Record<string, string>,
      ),
      namespace,
    );
  } catch {
    throw new Error(
      "Invalid tenant encryption configuration. No configuration values are logged.",
    );
  }
}
