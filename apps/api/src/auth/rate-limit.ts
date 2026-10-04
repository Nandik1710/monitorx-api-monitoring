import type { PrismaClient } from "@prisma/client";
import { tokenHash } from "@monitorx/security";
import { audit } from "./audit.js";
import { AuthError } from "./errors.js";

export async function rateLimit(
  db: PrismaClient,
  bucket: string,
  maximum: number,
  requestId: string,
  now = new Date(),
): Promise<void> {
  const key = tokenHash(bucket);
  const expiry = new Date(now.getTime() + 15 * 60_000);
  // An atomic PostgreSQL upsert shares counters across API replicas, independent of Redis.
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "AuthRateLimit" ("key", "count", "expiresAt") VALUES (${key}, 1, ${expiry})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "AuthRateLimit"."expiresAt" <= ${now} THEN 1 ELSE "AuthRateLimit"."count" + 1 END,
      "expiresAt" = CASE WHEN "AuthRateLimit"."expiresAt" <= ${now} THEN ${expiry} ELSE "AuthRateLimit"."expiresAt" END
    RETURNING "count"`;
  if ((rows[0]?.count ?? maximum + 1) > maximum) {
    await audit(db, "rate_limited", requestId);
    throw new AuthError(
      429,
      "RATE_LIMITED",
      "Too many requests. Try again later.",
    );
  }
}
