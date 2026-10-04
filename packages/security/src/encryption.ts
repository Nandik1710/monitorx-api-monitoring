import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptionContext {
  organizationId: string;
  environmentId: string;
  name: string;
}
export interface KeyProvider {
  readonly currentVersion: number;
  // Return an owned copy: the encryption layer zeroes it after every operation.
  getKey(version: number): Promise<Uint8Array>;
}
export class EncryptionError extends Error {
  constructor() {
    super("Secret encryption is unavailable.");
  }
}
export class LocalKeyProvider implements KeyProvider {
  readonly #keys: Map<number, Uint8Array>;
  constructor(
    readonly currentVersion: number,
    keys: Record<string, string>,
  ) {
    try {
      if (
        !Number.isSafeInteger(currentVersion) ||
        currentVersion < 1 ||
        Object.keys(keys).length > 20
      )
        throw new EncryptionError();
      this.#keys = new Map(
        Object.entries(keys).map(([version, encoded]) => {
          if (
            !/^[1-9]\d{0,8}$/.test(version) ||
            !/^[A-Za-z0-9+/]{43}=$/.test(encoded)
          )
            throw new EncryptionError();
          const key = Buffer.from(encoded, "base64");
          if (key.length !== 32 || key.toString("base64") !== encoded)
            throw new EncryptionError();
          return [Number(version), key];
        }),
      );
      if (!this.#keys.has(currentVersion)) throw new EncryptionError();
    } catch {
      throw new EncryptionError();
    }
  }
  async getKey(version: number): Promise<Uint8Array> {
    const key = this.#keys.get(version);
    if (!key) throw new EncryptionError();
    return new Uint8Array(key);
  }
}

// Deployment adapters can unwrap versioned data keys using KMS without changing
// this encryption format. No cloud SDK, credentials or network calls are required locally.
export class TenantEncryption {
  constructor(
    private readonly provider: KeyProvider,
    private readonly namespace = "monitorx:environment-secret",
  ) {
    if (!namespace || namespace.length > 200) throw new EncryptionError();
  }
  private aad(context: EncryptionContext, version: number): Buffer {
    return Buffer.from(
      JSON.stringify([
        this.namespace,
        context.organizationId,
        context.environmentId,
        context.name,
        "aes-256-gcm",
        version,
      ]),
    );
  }
  async encrypt(
    value: string,
    context: EncryptionContext,
  ): Promise<{ ciphertext: string; keyVersion: number }> {
    let key: Uint8Array | undefined;
    try {
      const version = this.provider.currentVersion;
      key = await this.provider.getKey(version);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv, {
        authTagLength: 16,
      });
      cipher.setAAD(this.aad(context, version));
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return {
        ciphertext: JSON.stringify({
          format: 1,
          algorithm: "aes-256-gcm",
          iv: iv.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
          data: encrypted.toString("base64"),
        }),
        keyVersion: version,
      };
    } catch {
      throw new EncryptionError();
    } finally {
      key?.fill(0);
    }
  }
  async decrypt(
    record: { ciphertext: string; keyVersion: number },
    context: EncryptionContext,
  ): Promise<string> {
    let key: Uint8Array | undefined;
    try {
      if (
        record.ciphertext.length > 60000 ||
        !Number.isSafeInteger(record.keyVersion) ||
        record.keyVersion < 1
      )
        throw new EncryptionError();
      const raw: unknown = JSON.parse(record.ciphertext);
      if (typeof raw !== "object" || raw === null) throw new EncryptionError();
      const data = raw as Record<string, unknown>;
      if (
        Object.keys(data).sort().join(",") !== "algorithm,data,format,iv,tag" ||
        data["format"] !== 1 ||
        data["algorithm"] !== "aes-256-gcm"
      )
        throw new EncryptionError();
      const decode = (value: unknown): Buffer => {
        if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
          throw new EncryptionError();
        const buffer = Buffer.from(value, "base64");
        if (buffer.toString("base64") !== value) throw new EncryptionError();
        return buffer;
      };
      const iv = decode(data["iv"]);
      const tag = decode(data["tag"]);
      if (iv.length !== 12 || tag.length !== 16) throw new EncryptionError();
      key = await this.provider.getKey(record.keyVersion);
      const decipher = createDecipheriv("aes-256-gcm", key, iv, {
        authTagLength: 16,
      });
      decipher.setAAD(this.aad(context, record.keyVersion));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(decode(data["data"])),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new EncryptionError();
    } finally {
      key?.fill(0);
    }
  }
}
