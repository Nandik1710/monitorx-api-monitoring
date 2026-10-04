-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "BodyMode" AS ENUM ('NONE', 'JSON', 'RAW', 'XML', 'FORM_URLENCODED');

-- CreateEnum
CREATE TYPE "ScheduleRunKind" AS ENUM ('TEST', 'COLLECTION');

-- CreateEnum
CREATE TYPE "RunKind" AS ENUM ('MANUAL', 'SCHEDULED', 'COLLECTION');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'DEGRADED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HealthState" AS ENUM ('HEALTHY', 'DEGRADED', 'DOWN', 'PAUSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AssertionSeverity" AS ENUM ('REQUIRED', 'WARNING');

-- CreateEnum
CREATE TYPE "IncidentState" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IncidentEventType" AS ENUM ('OPENED', 'STATE_CHANGED', 'EXECUTION_ATTACHED', 'NOTE_ADDED', 'ALERT_TRIGGERED', 'RECOVERED');

-- CreateEnum
CREATE TYPE "NotificationChannelType" AS ENUM ('EMAIL', 'SLACK', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENDING', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "passwordHash" VARCHAR(255),
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'VIEWER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Environment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "variables" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvironmentSecret" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvironmentSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiTest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "collectionId" UUID NOT NULL,
    "environmentId" UUID,
    "name" VARCHAR(160) NOT NULL,
    "method" VARCHAR(16) NOT NULL,
    "urlTemplate" VARCHAR(2048) NOT NULL,
    "queryRows" JSONB NOT NULL,
    "headerRows" JSONB NOT NULL,
    "bodyMode" "BodyMode" NOT NULL DEFAULT 'NONE',
    "bodyTemplate" TEXT,
    "authConfig" JSONB,
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "followRedirects" BOOLEAN NOT NULL DEFAULT false,
    "assertions" JSONB NOT NULL,
    "tags" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "kind" "ScheduleRunKind" NOT NULL DEFAULT 'TEST',
    "intervalMinutes" INTEGER,
    "cronExpression" VARCHAR(120),
    "timeZone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pausedAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "scheduleId" UUID,
    "environmentId" UUID,
    "runKind" "RunKind" NOT NULL DEFAULT 'MANUAL',
    "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "healthState" "HealthState" NOT NULL DEFAULT 'UNKNOWN',
    "logicalKey" VARCHAR(255),
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "httpStatus" INTEGER,
    "errorClass" VARCHAR(80),
    "errorMessage" TEXT,
    "requestMetadata" JSONB,
    "responsePreview" TEXT,
    "responseBytes" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssertionResult" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "severity" "AssertionSeverity" NOT NULL DEFAULT 'REQUIRED',
    "expected" JSONB,
    "actual" JSONB,
    "passed" BOOLEAN NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssertionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "environmentId" UUID,
    "dedupeKey" VARCHAR(255) NOT NULL,
    "state" "IncidentState" NOT NULL DEFAULT 'OPEN',
    "healthState" "HealthState" NOT NULL DEFAULT 'DOWN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "investigatingAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "executionId" UUID,
    "actorUserId" UUID,
    "type" "IncidentEventType" NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "NotificationChannelType" NOT NULL,
    "configCiphertext" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertDelivery" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "executionId" UUID,
    "channelId" UUID NOT NULL,
    "eventId" VARCHAR(255) NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "keyPrefix" VARCHAR(24) NOT NULL,
    "keyHash" VARCHAR(255) NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "actorUserId" UUID,
    "action" VARCHAR(120) NOT NULL,
    "entityType" VARCHAR(80),
    "entityId" UUID,
    "requestId" VARCHAR(120),
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_createdAt_idx" ON "User"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_createdAt_idx" ON "Organization"("createdAt");

-- CreateIndex
CREATE INDEX "Membership_organizationId_role_status_idx" ON "Membership"("organizationId", "role", "status");

-- CreateIndex
CREATE INDEX "Membership_userId_status_idx" ON "Membership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Project_organizationId_archivedAt_createdAt_idx" ON "Project"("organizationId", "archivedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_organizationId_slug_key" ON "Project"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Project_organizationId_name_key" ON "Project"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Collection_organizationId_projectId_createdAt_idx" ON "Collection"("organizationId", "projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_projectId_name_key" ON "Collection"("projectId", "name");

-- CreateIndex
CREATE INDEX "Environment_organizationId_projectId_createdAt_idx" ON "Environment"("organizationId", "projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Environment_projectId_name_key" ON "Environment"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Environment_projectId_slug_key" ON "Environment"("projectId", "slug");

-- CreateIndex
CREATE INDEX "EnvironmentSecret_organizationId_environmentId_updatedAt_idx" ON "EnvironmentSecret"("organizationId", "environmentId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentSecret_environmentId_key_key" ON "EnvironmentSecret"("environmentId", "key");

-- CreateIndex
CREATE INDEX "ApiTest_organizationId_projectId_enabled_updatedAt_idx" ON "ApiTest"("organizationId", "projectId", "enabled", "updatedAt");

-- CreateIndex
CREATE INDEX "ApiTest_organizationId_collectionId_createdAt_idx" ON "ApiTest"("organizationId", "collectionId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiTest_organizationId_environmentId_idx" ON "ApiTest"("organizationId", "environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiTest_collectionId_name_key" ON "ApiTest"("collectionId", "name");

-- CreateIndex
CREATE INDEX "Schedule_organizationId_enabled_nextRunAt_idx" ON "Schedule"("organizationId", "enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "Schedule_organizationId_testId_idx" ON "Schedule"("organizationId", "testId");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_testId_key" ON "Schedule"("testId");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_logicalKey_key" ON "Execution"("logicalKey");

-- CreateIndex
CREATE INDEX "Execution_organizationId_testId_createdAt_idx" ON "Execution"("organizationId", "testId", "createdAt");

-- CreateIndex
CREATE INDEX "Execution_organizationId_status_createdAt_idx" ON "Execution"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Execution_organizationId_scheduledAt_runKind_idx" ON "Execution"("organizationId", "scheduledAt", "runKind");

-- CreateIndex
CREATE INDEX "Execution_expiresAt_idx" ON "Execution"("expiresAt");

-- CreateIndex
CREATE INDEX "AssertionResult_organizationId_executionId_passed_idx" ON "AssertionResult"("organizationId", "executionId", "passed");

-- CreateIndex
CREATE UNIQUE INDEX "AssertionResult_executionId_position_key" ON "AssertionResult"("executionId", "position");

-- CreateIndex
CREATE INDEX "Incident_organizationId_state_openedAt_idx" ON "Incident"("organizationId", "state", "openedAt");

-- CreateIndex
CREATE INDEX "Incident_organizationId_dedupeKey_state_idx" ON "Incident"("organizationId", "dedupeKey", "state");

-- CreateIndex
CREATE INDEX "Incident_organizationId_testId_environmentId_state_idx" ON "Incident"("organizationId", "testId", "environmentId", "state");

-- CreateIndex
CREATE INDEX "Incident_expiresAt_idx" ON "Incident"("expiresAt");

-- CreateIndex
CREATE INDEX "IncidentEvent_organizationId_incidentId_createdAt_idx" ON "IncidentEvent"("organizationId", "incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "IncidentEvent_organizationId_executionId_idx" ON "IncidentEvent"("organizationId", "executionId");

-- CreateIndex
CREATE INDEX "NotificationChannel_organizationId_enabled_type_idx" ON "NotificationChannel"("organizationId", "enabled", "type");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannel_organizationId_name_key" ON "NotificationChannel"("organizationId", "name");

-- CreateIndex
CREATE INDEX "AlertDelivery_organizationId_status_nextAttemptAt_idx" ON "AlertDelivery"("organizationId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AlertDelivery_organizationId_incidentId_createdAt_idx" ON "AlertDelivery"("organizationId", "incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertDelivery_expiresAt_idx" ON "AlertDelivery"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlertDelivery_organizationId_channelId_eventId_key" ON "AlertDelivery"("organizationId", "channelId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_revokedAt_expiresAt_idx" ON "ApiKey"("organizationId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_organizationId_keyPrefix_key" ON "ApiKey"("organizationId", "keyPrefix");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_action_createdAt_idx" ON "AuditLog"("organizationId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_expiresAt_idx" ON "AuditLog"("expiresAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentSecret" ADD CONSTRAINT "EnvironmentSecret_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentSecret" ADD CONSTRAINT "EnvironmentSecret_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiTest" ADD CONSTRAINT "ApiTest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiTest" ADD CONSTRAINT "ApiTest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiTest" ADD CONSTRAINT "ApiTest_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiTest" ADD CONSTRAINT "ApiTest_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ApiTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ApiTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssertionResult" ADD CONSTRAINT "AssertionResult_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssertionResult" ADD CONSTRAINT "AssertionResult_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ApiTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
