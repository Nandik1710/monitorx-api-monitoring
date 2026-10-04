CREATE TABLE "CollectionRun" (
 "id" UUID PRIMARY KEY, "organizationId" UUID NOT NULL, "projectId" UUID NOT NULL,
 "collectionId" UUID NOT NULL, "environmentId" UUID NOT NULL, "requestedById" UUID NOT NULL,
 "parallelism" INTEGER NOT NULL DEFAULT 2 CHECK ("parallelism" BETWEEN 1 AND 5),
 "cancelledAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CollectionRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "CollectionRun_organizationId_projectId_collectionId_fkey" FOREIGN KEY ("organizationId","projectId","collectionId") REFERENCES "Collection"("organizationId","projectId","id") ON DELETE NO ACTION ON UPDATE CASCADE,
 CONSTRAINT "CollectionRun_organizationId_environmentId_fkey" FOREIGN KEY ("organizationId","environmentId") REFERENCES "Environment"("organizationId","id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE INDEX "CollectionRun_organizationId_createdAt_idx" ON "CollectionRun"("organizationId","createdAt");
ALTER TABLE "Execution" ADD COLUMN "configSnapshot" JSONB, ADD COLUMN "requestedById" UUID,
 ADD COLUMN "collectionRunId" UUID, ADD COLUMN "leaseUntil" TIMESTAMP(3),
 ADD COLUMN "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_collectionRunId_fkey" FOREIGN KEY ("collectionRunId") REFERENCES "CollectionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Execution_status_availableAt_idx" ON "Execution"("status","availableAt");
CREATE INDEX "Execution_organizationId_collectionRunId_status_idx" ON "Execution"("organizationId","collectionRunId","status");
CREATE TABLE "ExecutionEvent" (
 "id" BIGSERIAL PRIMARY KEY, "organizationId" UUID NOT NULL, "executionId" UUID NOT NULL,
 "type" VARCHAR(40) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ExecutionEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ExecutionEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ExecutionEvent_organizationId_id_idx" ON "ExecutionEvent"("organizationId","id");
