import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const seededAt = new Date("2026-01-01T00:00:00.000Z");

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  organization: "00000000-0000-4000-8000-000000000002",
  project: "00000000-0000-4000-8000-000000000003",
  collection: "00000000-0000-4000-8000-000000000004",
  environment: "00000000-0000-4000-8000-000000000005",
  secret: "00000000-0000-4000-8000-000000000006",
  test: "00000000-0000-4000-8000-000000000007",
  schedule: "00000000-0000-4000-8000-000000000008",
  execution: "00000000-0000-4000-8000-000000000009",
  assertion: "00000000-0000-4000-8000-000000000010",
  incident: "00000000-0000-4000-8000-000000000011",
  incidentEvent: "00000000-0000-4000-8000-000000000012",
  channel: "00000000-0000-4000-8000-000000000013",
  delivery: "00000000-0000-4000-8000-000000000014",
  apiKey: "00000000-0000-4000-8000-000000000015",
  auditLog: "00000000-0000-4000-8000-000000000016",
} as const;

async function main(): Promise<void> {
  await prisma.user.upsert({
    where: { id: ids.user },
    update: { displayName: "Monitor-X Local Owner", status: "ACTIVE" },
    create: {
      id: ids.user,
      email: "owner@monitorx.local",
      displayName: "Monitor-X Local Owner",
      status: "ACTIVE",
      emailVerifiedAt: seededAt,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.organization.upsert({
    where: { id: ids.organization },
    update: { name: "Monitor-X Local Organization" },
    create: {
      id: ids.organization,
      name: "Monitor-X Local Organization",
      slug: "monitorx-local",
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.membership.upsert({
    where: {
      organizationId_userId: {
        organizationId: ids.organization,
        userId: ids.user,
      },
    },
    update: { role: "OWNER", status: "ACTIVE", acceptedAt: seededAt },
    create: {
      organizationId: ids.organization,
      userId: ids.user,
      role: "OWNER",
      status: "ACTIVE",
      acceptedAt: seededAt,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.project.upsert({
    where: { id: ids.project },
    update: { name: "Local API Project" },
    create: {
      id: ids.project,
      organizationId: ids.organization,
      name: "Local API Project",
      slug: "local-api-project",
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.collection.upsert({
    where: { id: ids.collection },
    update: { description: "Deterministic local fixture collection" },
    create: {
      id: ids.collection,
      organizationId: ids.organization,
      projectId: ids.project,
      name: "Local Health Checks",
      description: "Deterministic local fixture collection",
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.environment.upsert({
    where: { id: ids.environment },
    update: { variables: { BASE_URL: "http://localhost:4000" } },
    create: {
      id: ids.environment,
      organizationId: ids.organization,
      projectId: ids.project,
      name: "Local",
      slug: "local",
      variables: { BASE_URL: "http://localhost:4000" },
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.environmentSecret.upsert({
    where: { id: ids.secret },
    update: { ciphertext: "local-fixture-ciphertext-v1", keyVersion: 1 },
    create: {
      id: ids.secret,
      organizationId: ids.organization,
      environmentId: ids.environment,
      key: "EXAMPLE_SECRET",
      ciphertext: "local-fixture-ciphertext-v1",
      keyVersion: 1,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.apiTest.upsert({
    where: { id: ids.test },
    update: { enabled: true },
    create: {
      id: ids.test,
      organizationId: ids.organization,
      projectId: ids.project,
      collectionId: ids.collection,
      environmentId: ids.environment,
      name: "API health endpoint",
      method: "GET",
      urlTemplate: "{{BASE_URL}}/health/live",
      queryRows: [],
      headerRows: [],
      bodyMode: "NONE",
      authConfig: null,
      timeoutMs: 10000,
      followRedirects: false,
      assertions: [{ type: "status", expected: 200, severity: "REQUIRED" }],
      tags: ["foundation", "local"],
      enabled: true,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.schedule.upsert({
    where: { id: ids.schedule },
    update: { enabled: false },
    create: {
      id: ids.schedule,
      organizationId: ids.organization,
      testId: ids.test,
      kind: "TEST",
      intervalMinutes: 5,
      timeZone: "UTC",
      enabled: false,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.execution.upsert({
    where: { id: ids.execution },
    update: { status: "PASSED", healthState: "HEALTHY" },
    create: {
      id: ids.execution,
      organizationId: ids.organization,
      testId: ids.test,
      scheduleId: ids.schedule,
      environmentId: ids.environment,
      runKind: "SCHEDULED",
      status: "PASSED",
      healthState: "HEALTHY",
      logicalKey: "seed-execution-2026-01-01",
      scheduledAt: seededAt,
      startedAt: seededAt,
      completedAt: seededAt,
      latencyMs: 12,
      httpStatus: 200,
      requestMetadata: { method: "GET", path: "/health/live" },
      responsePreview: '{"status":"ok"}',
      responseBytes: 15,
      expiresAt: new Date("2026-04-01T00:00:00.000Z"),
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.assertionResult.upsert({
    where: { id: ids.assertion },
    update: { passed: true },
    create: {
      id: ids.assertion,
      organizationId: ids.organization,
      executionId: ids.execution,
      position: 0,
      type: "status",
      severity: "REQUIRED",
      expected: 200,
      actual: 200,
      passed: true,
      message: "Status matched",
      createdAt: seededAt,
    },
  });

  await prisma.incident.upsert({
    where: { id: ids.incident },
    update: { state: "RESOLVED", healthState: "HEALTHY" },
    create: {
      id: ids.incident,
      organizationId: ids.organization,
      testId: ids.test,
      environmentId: ids.environment,
      dedupeKey: "seed-api-health-local",
      state: "RESOLVED",
      healthState: "HEALTHY",
      openedAt: seededAt,
      resolvedAt: seededAt,
      lastFailureAt: seededAt,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.incidentEvent.upsert({
    where: { id: ids.incidentEvent },
    update: { note: "Seeded recovery event" },
    create: {
      id: ids.incidentEvent,
      organizationId: ids.organization,
      incidentId: ids.incident,
      executionId: ids.execution,
      actorUserId: ids.user,
      type: "RECOVERED",
      note: "Seeded recovery event",
      metadata: { source: "seed" },
      createdAt: seededAt,
    },
  });

  await prisma.notificationChannel.upsert({
    where: { id: ids.channel },
    update: { enabled: false },
    create: {
      id: ids.channel,
      organizationId: ids.organization,
      name: "Local disabled email",
      type: "EMAIL",
      configCiphertext: "local-fixture-channel-config-v1",
      keyVersion: 1,
      enabled: false,
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.alertDelivery.upsert({
    where: {
      organizationId_channelId_eventId: {
        organizationId: ids.organization,
        channelId: ids.channel,
        eventId: "seed-incident-recovered",
      },
    },
    update: { status: "DELIVERED", deliveredAt: seededAt },
    create: {
      id: ids.delivery,
      organizationId: ids.organization,
      incidentId: ids.incident,
      executionId: ids.execution,
      channelId: ids.channel,
      eventId: "seed-incident-recovered",
      status: "DELIVERED",
      attemptCount: 1,
      deliveredAt: seededAt,
      expiresAt: new Date("2026-04-01T00:00:00.000Z"),
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.apiKey.upsert({
    where: { id: ids.apiKey },
    update: { revokedAt: null },
    create: {
      id: ids.apiKey,
      organizationId: ids.organization,
      name: "Local fixture key",
      keyPrefix: "mx_local_fixture",
      keyHash: "local-fixture-key-hash-v1",
      scopes: ["read:health"],
      createdAt: seededAt,
      updatedAt: seededAt,
    },
  });

  await prisma.auditLog.upsert({
    where: { id: ids.auditLog },
    update: { action: "seed.completed" },
    create: {
      id: ids.auditLog,
      organizationId: ids.organization,
      actorUserId: ids.user,
      action: "seed.completed",
      entityType: "Organization",
      entityId: ids.organization,
      requestId: "seed-request-2026-01-01",
      metadata: { source: "deterministic-local-seed" },
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      createdAt: seededAt,
    },
  });
}

main()
  .catch((error: unknown) => {
    console.error(
      "Database seed failed",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
