BEGIN;
CREATE TABLE "OrganizationInvitation" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL, "role" "MembershipRole" NOT NULL,
  "invitedById" UUID NOT NULL, "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "acceptedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrganizationInvitation_tokenHash_key" ON "OrganizationInvitation"("tokenHash");
CREATE INDEX "OrganizationInvitation_organizationId_email_createdAt_idx" ON "OrganizationInvitation"("organizationId", "email", "createdAt");
CREATE INDEX "OrganizationInvitation_organizationId_expiresAt_idx" ON "OrganizationInvitation"("organizationId", "expiresAt");

CREATE UNIQUE INDEX "Project_organizationId_id_key" ON "Project"("organizationId", "id");
CREATE UNIQUE INDEX "Environment_organizationId_id_key" ON "Environment"("organizationId", "id");
ALTER TABLE "Environment" DROP CONSTRAINT "Environment_projectId_fkey";
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_organizationId_projectId_fkey"
  FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnvironmentSecret" DROP CONSTRAINT "EnvironmentSecret_environmentId_fkey";
ALTER TABLE "EnvironmentSecret" ADD CONSTRAINT "EnvironmentSecret_organizationId_environmentId_fkey"
  FOREIGN KEY ("organizationId", "environmentId") REFERENCES "Environment"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
