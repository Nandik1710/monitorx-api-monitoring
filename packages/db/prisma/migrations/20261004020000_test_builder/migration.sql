BEGIN;
ALTER TABLE "Organization" ADD COLUMN "testTimeoutLimitMs" INTEGER NOT NULL DEFAULT 30000;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_testTimeoutLimitMs_check" CHECK ("testTimeoutLimitMs" BETWEEN 100 AND 30000);
ALTER TABLE "ApiTest" ADD COLUMN "advancedMethod" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "formRows" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "maxRedirects" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ApiTest" ALTER COLUMN "enabled" SET DEFAULT false;
-- Preserve existing definitions; do not silently enable or rewrite legacy requests.
ALTER TABLE "ApiTest" ADD CONSTRAINT "ApiTest_revision_check" CHECK ("revision" > 0);
ALTER TABLE "ApiTest" ADD CONSTRAINT "ApiTest_maxRedirects_check" CHECK ("maxRedirects" BETWEEN 0 AND 3);
CREATE UNIQUE INDEX "Collection_organizationId_projectId_id_key" ON "Collection"("organizationId", "projectId", "id");
CREATE UNIQUE INDEX "Environment_organizationId_projectId_id_key" ON "Environment"("organizationId", "projectId", "id");
ALTER TABLE "Collection" DROP CONSTRAINT "Collection_projectId_fkey";
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiTest" DROP CONSTRAINT "ApiTest_projectId_fkey", DROP CONSTRAINT "ApiTest_collectionId_fkey", DROP CONSTRAINT "ApiTest_environmentId_fkey";
ALTER TABLE "ApiTest" ADD CONSTRAINT "ApiTest_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiTest" ADD CONSTRAINT "ApiTest_organizationId_projectId_collectionId_fkey" FOREIGN KEY ("organizationId", "projectId", "collectionId") REFERENCES "Collection"("organizationId", "projectId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "ApiTest" ADD CONSTRAINT "ApiTest_organizationId_projectId_environmentId_fkey" FOREIGN KEY ("organizationId", "projectId", "environmentId") REFERENCES "Environment"("organizationId", "projectId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
COMMIT;
