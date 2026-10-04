import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const integrationEnabled = process.env.RUN_INTEGRATION === "true";
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://monitorx:local_development_only@localhost:5432/monitorx?schema=public";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

describe.skipIf(!integrationEnabled)(
  "PostgreSQL and Redis integration setup",
  () => {
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    const redis = new Redis(redisUrl, { lazyConnect: true });
    const organizationIds: string[] = [];

    beforeAll(async () => {
      await prisma.$connect();
      await redis.connect();
    });

    afterAll(async () => {
      for (const organizationId of organizationIds) {
        await prisma.organization.delete({ where: { id: organizationId } });
      }
      await redis.del("monitorx:integration:health");
      await redis.quit();
      await prisma.$disconnect();
    });

    it("connects to both local dependencies", async () => {
      expect(await prisma.$queryRaw`SELECT 1`).toBeDefined();
      expect(
        await redis.set("monitorx:integration:health", "ok", "EX", 30),
      ).toBe("OK");
      expect(await redis.get("monitorx:integration:health")).toBe("ok");
    });

    it("enforces a relational constraint and keeps tenant scope explicit", async () => {
      const organizationA = await prisma.organization.create({
        data: {
          name: "Integration Tenant A",
          slug: `integration-a-${Date.now()}`,
        },
      });
      const organizationB = await prisma.organization.create({
        data: {
          name: "Integration Tenant B",
          slug: `integration-b-${Date.now()}`,
        },
      });
      organizationIds.push(organizationA.id, organizationB.id);

      const projectA = await prisma.project.create({
        data: {
          organizationId: organizationA.id,
          name: "Tenant A Project",
          slug: "tenant-a-project",
        },
      });

      await expect(
        prisma.project.create({
          data: {
            organizationId: organizationA.id,
            name: "Tenant A Project",
            slug: "tenant-a-project",
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });

      const crossTenantLookup = await prisma.project.findFirst({
        where: { id: projectA.id, organizationId: organizationB.id },
      });
      expect(crossTenantLookup).toBeNull();
    });

    it("includes organization identifiers on every organization-owned table", async () => {
      const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'organizationId'
    `;
      const tablesWithTenantId = new Set(rows.map((row) => row.table_name));
      const organizationOwnedTables = [
        "Membership",
        "Project",
        "Collection",
        "Environment",
        "EnvironmentSecret",
        "ApiTest",
        "Schedule",
        "Execution",
        "AssertionResult",
        "Incident",
        "IncidentEvent",
        "NotificationChannel",
        "AlertDelivery",
        "ApiKey",
        "AuditLog",
      ];

      expect(
        organizationOwnedTables.every((table) => tablesWithTenantId.has(table)),
      ).toBe(true);
    });
  },
);
