import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP scrypt profile: N=2^17, r=8, p=1 (~128 MiB per derivation).
const parameters = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, parameters, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `scrypt$131072$8$1$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string | null,
): Promise<boolean> {
  const parts = encoded?.split("$") ?? [];
  const valid =
    parts.length === 6 &&
    parts.slice(0, 4).join("$") === "scrypt$131072$8$1" &&
    /^[a-f0-9]{32}$/.test(parts[4] ?? "") &&
    /^[a-f0-9]{128}$/.test(parts[5] ?? "");
  // Missing/OAuth accounts still do the same expensive derivation.
  const key = await derive(password, valid ? parts[4]! : "0".repeat(32));
  return (
    timingSafeEqual(
      key,
      Buffer.from(valid ? parts[5]! : "0".repeat(128), "hex"),
    ) && valid
  );
}

export const newToken = (): string => randomBytes(32).toString("base64url");
export const tokenHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
export function equalTokens(a: string, b: string): boolean {
  return timingSafeEqual(
    Buffer.from(tokenHash(a), "hex"),
    Buffer.from(tokenHash(b), "hex"),
  );
}
