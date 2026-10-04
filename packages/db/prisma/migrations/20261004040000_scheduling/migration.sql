ALTER TABLE "Organization" ADD COLUMN "executionRateLimitPerMinute" INTEGER CHECK ("executionRateLimitPerMinute" BETWEEN 1 AND 10000);
CREATE UNIQUE INDEX "ApiTest_organizationId_id_key" ON "ApiTest"("organizationId", "id");
ALTER TABLE "Schedule" ADD COLUMN "environmentId" UUID, ADD COLUMN "createdById" UUID,
 ADD COLUMN "cadence" VARCHAR(12) NOT NULL DEFAULT 'INTERVAL', ADD COLUMN "hour" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "minute" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "maintenanceWindows" JSONB NOT NULL DEFAULT '[]',
 ADD COLUMN "failureThreshold" INTEGER NOT NULL DEFAULT 2, ADD COLUMN "recoveryThreshold" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_cadence_check" CHECK ("cadence" IN ('INTERVAL','HOURLY','DAILY')),
 ADD CONSTRAINT "Schedule_clock_check" CHECK ("hour" BETWEEN 0 AND 23 AND "minute" BETWEEN 0 AND 59),
 ADD CONSTRAINT "Schedule_threshold_check" CHECK ("failureThreshold" BETWEEN 1 AND 20 AND "recoveryThreshold" BETWEEN 1 AND 20);
ALTER TABLE "Schedule" DROP CONSTRAINT "Schedule_testId_fkey";
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_organizationId_testId_fkey" FOREIGN KEY ("organizationId","testId") REFERENCES "ApiTest"("organizationId","id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_organizationId_environmentId_fkey" FOREIGN KEY ("organizationId","environmentId") REFERENCES "Environment"("organizationId","id") ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE INDEX "Schedule_enabled_nextRunAt_idx" ON "Schedule"("enabled","nextRunAt");
ALTER TABLE "Execution" ADD COLUMN "targetHostHash" CHAR(64), ADD COLUMN "deferCount" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "Execution_testId_scheduledAt_runKind_key" ON "Execution"("testId","scheduledAt","runKind");
CREATE INDEX "Execution_targetHostHash_status_idx" ON "Execution"("targetHostHash","status");
CREATE INDEX "Execution_organizationId_startedAt_idx" ON "Execution"("organizationId","startedAt");
