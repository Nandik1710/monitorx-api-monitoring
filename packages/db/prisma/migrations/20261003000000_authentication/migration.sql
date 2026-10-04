-- Global identity records intentionally have no organizationId. Authorization of
-- organization resources remains a separate, membership-scoped concern.
ALTER TABLE "User" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3), ADD COLUMN "githubId" VARCHAR(40);
ALTER TABLE "User" ADD CONSTRAINT "User_failedLoginCount_check" CHECK ("failedLoginCount" >= 0);
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

CREATE TYPE "AuthTokenPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');
CREATE TABLE "AuthSession" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "familyId" UUID NOT NULL,
  "accessHash" CHAR(64) NOT NULL, "refreshHash" CHAR(64) NOT NULL,
  "accessExpiresAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AuthSession_expiry_check" CHECK ("accessExpiresAt" <= "expiresAt")
);
CREATE UNIQUE INDEX "AuthSession_accessHash_key" ON "AuthSession"("accessHash");
CREATE UNIQUE INDEX "AuthSession_refreshHash_key" ON "AuthSession"("refreshHash");
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");
CREATE INDEX "AuthSession_familyId_idx" ON "AuthSession"("familyId");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

CREATE TABLE "AuthToken" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "tokenHash" CHAR(64) NOT NULL,
  "purpose" "AuthTokenPurpose" NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");
CREATE INDEX "AuthToken_userId_purpose_idx" ON "AuthToken"("userId", "purpose");
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");

CREATE TABLE "AuthRateLimit" (
  "key" CHAR(64) NOT NULL, "count" INTEGER NOT NULL DEFAULT 1, "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "AuthRateLimit_count_check" CHECK ("count" >= 1)
);
CREATE INDEX "AuthRateLimit_expiresAt_idx" ON "AuthRateLimit"("expiresAt");

CREATE TABLE "OAuthAttempt" (
  "stateHash" CHAR(64) NOT NULL, "verifierHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3),
  CONSTRAINT "OAuthAttempt_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX "OAuthAttempt_expiresAt_idx" ON "OAuthAttempt"("expiresAt");
