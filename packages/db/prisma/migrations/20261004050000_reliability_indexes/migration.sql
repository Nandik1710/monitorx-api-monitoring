CREATE INDEX "Execution_organizationId_completedAt_idx" ON "Execution"("organizationId", "completedAt");
CREATE INDEX "Execution_organizationId_environmentId_createdAt_idx" ON "Execution"("organizationId", "environmentId", "createdAt");
CREATE INDEX "Execution_organizationId_testId_completedAt_idx" ON "Execution"("organizationId", "testId", "completedAt");
