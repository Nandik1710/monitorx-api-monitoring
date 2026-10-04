import { Prisma } from "@prisma/client";
import {
  historyQuerySchema,
  metricsQuerySchema,
  inMaintenance,
  type TenantContext,
  type ReliabilityScope,
  type Dashboard,
} from "@monitorx/contracts";
import { type TenantAccess, notFound } from "./tenant-access.js";
import { runView } from "./run-service.js";

const retention = (now: Date): Prisma.ExecutionWhereInput => ({
  createdAt: { gte: new Date(now.getTime() - 90 * 86400000) },
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});
async function scope(
  tx: Prisma.TransactionClient,
  organizationId: string,
  kind: ReliabilityScope,
  id: string,
) {
  const where = { id, organizationId };
  const row =
    kind === "projects"
      ? await tx.project.findFirst({ where })
      : kind === "collections"
        ? await tx.collection.findFirst({ where })
        : await tx.apiTest.findFirst({ where });
  if (!row) throw notFound();
  return {
    name: row.name,
    test: {
      organizationId,
      ...(kind === "projects"
        ? { projectId: id }
        : kind === "collections"
          ? { collectionId: id }
          : { id }),
    },
  };
}
export class ReliabilityService {
  constructor(private readonly access: TenantAccess) {}
  history(
    ctx: TenantContext,
    kind: ReliabilityScope,
    id: string,
    raw: unknown,
  ) {
    const q = historyQuerySchema.parse(raw);
    return this.access.scoped(ctx, "read", async (tx, c) => {
      const s = await scope(tx, c.organizationId, kind, id);
      const where: Prisma.ExecutionWhereInput = {
        organizationId: c.organizationId,
        AND: [
          retention(new Date()),
          {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          },
        ],
        test: { ...s.test, ...(q.tag ? { tags: { has: q.tag } } : {}) },
        ...(q.status ? { status: q.status } : {}),
        ...(q.environmentId ? { environmentId: q.environmentId } : {}),
        ...(q.runKind ? { runKind: q.runKind } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.execution.findMany({
          where,
          include: { test: { select: { name: true } } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        tx.execution.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          ...runView(row),
          testName: row.test.name,
          environmentId: row.environmentId,
          runKind: row.runKind,
          startedAt: row.startedAt,
        })),
        total,
        page: q.page,
        limit: q.limit,
      };
    });
  }
  detail(ctx: TenantContext, id: string) {
    return this.access.scoped(ctx, "read", async (tx, c) => {
      const now = new Date();
      const row = await tx.execution.findFirst({
        where: { id, organizationId: c.organizationId, ...retention(now) },
        include: {
          test: { select: { name: true } },
          assertionResults: {
            where: { organizationId: c.organizationId },
            orderBy: { position: "asc" },
          },
        },
      });
      if (!row) throw notFound();
      const previewExpired =
        (row.completedAt ?? row.createdAt).getTime() <
        now.getTime() - 7 * 86400000;
      return {
        ...runView(row),
        testName: row.test.name,
        environmentId: row.environmentId,
        runKind: row.runKind,
        startedAt: row.startedAt,
        errorMessage: row.errorMessage,
        requestMetadata: row.requestMetadata,
        responsePreview: previewExpired ? null : row.responsePreview,
        previewExpired,
        responseBytes: row.responseBytes,
        assertions: row.assertionResults.map((a) => ({
          position: a.position,
          type: a.type,
          severity: a.severity,
          passed: a.passed,
          expected: a.expected,
          actual: a.actual,
          message: a.message,
        })),
      };
    });
  }
  dashboard(
    ctx: TenantContext,
    kind: ReliabilityScope,
    id: string,
    raw: unknown,
  ) {
    const { range } = metricsQuerySchema.parse(raw);
    return this.access.scoped(ctx, "read", async (tx, c) => {
      const s = await scope(tx, c.organizationId, kind, id);
      const now = new Date(),
        since = new Date(
          now.getTime() - { "24h": 1, "7d": 7, "30d": 30 }[range] * 86400000,
        );
      const selector =
        kind === "projects"
          ? Prisma.sql`t."projectId" = ${id}::uuid`
          : kind === "collections"
            ? Prisma.sql`t."collectionId" = ${id}::uuid`
            : Prisma.sql`t.id = ${id}::uuid`;
      const base = Prisma.sql`FROM "Execution" e JOIN "ApiTest" t ON t.id = e."testId" AND t."organizationId" = e."organizationId" WHERE e."organizationId" = ${c.organizationId}::uuid AND ${selector} AND e."completedAt" >= ${since} AND e."completedAt" <= ${now} AND e."createdAt" >= ${new Date(now.getTime() - 90 * 86400000)} AND (e."expiresAt" IS NULL OR e."expiresAt" > ${now}) AND e.status IN ('PASSED', 'DEGRADED', 'FAILED')`;
      const [summary] = await tx.$queryRaw<Dashboard["summary"][]>(
        Prisma.sql`SELECT count(*)::int AS samples, count(*) FILTER (WHERE e."runKind" = 'SCHEDULED' AND e."healthState" IN ('HEALTHY','DEGRADED','DOWN'))::int AS "scheduledSamples", 100.0 * count(*) FILTER (WHERE e."runKind" = 'SCHEDULED' AND e."healthState" IN ('HEALTHY','DEGRADED')) / NULLIF(count(*) FILTER (WHERE e."runKind" = 'SCHEDULED' AND e."healthState" IN ('HEALTHY','DEGRADED','DOWN')),0)::float AS uptime, 100.0 * count(*) FILTER (WHERE e.status IN ('PASSED','DEGRADED')) / NULLIF(count(*),0)::float AS "passRate", avg(e."latencyMs")::float AS "averageMs", percentile_cont(0.50) WITHIN GROUP (ORDER BY e."latencyMs") AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY e."latencyMs") AS p95, percentile_cont(0.99) WITHIN GROUP (ORDER BY e."latencyMs") AS p99 ${base}`,
      );
      const errors = await tx.$queryRaw<Dashboard["errors"]>(
        Prisma.sql`SELECT e."errorClass", count(*)::int AS count ${base} AND e."errorClass" IS NOT NULL GROUP BY e."errorClass" ORDER BY count DESC, e."errorClass" LIMIT 20`,
      );
      const averages = await tx.$queryRaw<{ id: string; averageMs: number }[]>(
        Prisma.sql`SELECT e."testId" AS id, avg(e."latencyMs")::float AS "averageMs" ${base} AND e."latencyMs" IS NOT NULL GROUP BY e."testId"`,
      );
      const mean = new Map(averages.map((a) => [a.id, a.averageMs]));
      const latestRows = await tx.$queryRaw<
        {
          id: string;
          healthState: Dashboard["health"][number]["state"] | null;
          completedAt: Date | null;
        }[]
      >(Prisma.sql`
        SELECT t.id, latest."healthState", latest."completedAt" FROM "ApiTest" t
        LEFT JOIN LATERAL (SELECT e."healthState", e."completedAt" FROM "Execution" e
          WHERE e."organizationId" = ${c.organizationId}::uuid AND e."testId" = t.id
          AND e.status IN ('PASSED','DEGRADED','FAILED') AND e."completedAt" <= ${now}
          AND e."createdAt" >= ${new Date(now.getTime() - 90 * 86400000)}
          AND (e."expiresAt" IS NULL OR e."expiresAt" > ${now})
          ORDER BY e."completedAt" DESC, e.id DESC LIMIT 1) latest ON true
        WHERE t."organizationId" = ${c.organizationId}::uuid AND ${selector}`);
      const latestByTest = new Map(latestRows.map((row) => [row.id, row]));
      // Only test metadata and one indexed latest result per test cross into JS;
      // execution samples/percentiles stay in PostgreSQL, never in API memory.
      const tests = await tx.apiTest.findMany({
        where: s.test,
        select: {
          id: true,
          name: true,
          enabled: true,
          schedules: {
            select: {
              enabled: true,
              pausedAt: true,
              intervalMinutes: true,
              cadence: true,
              maintenanceWindows: true,
            },
          },
        },
      });
      const endpoints = tests.map((t) => {
        const schedule = t.schedules[0],
          latest = latestByTest.get(t.id);
        const paused =
          !t.enabled ||
          (schedule &&
            (!schedule.enabled ||
              schedule.pausedAt !== null ||
              inMaintenance(schedule.maintenanceWindows, now)));
        const staleMs = schedule
          ? schedule.cadence === "DAILY"
            ? 26 * 3600000
            : schedule.cadence === "HOURLY"
              ? 2 * 3600000
              : Math.max(5, (schedule.intervalMinutes ?? 5) * 2) * 60000
          : 86400000;
        const health: Dashboard["health"][number]["state"] = paused
          ? "PAUSED"
          : !latest?.completedAt ||
              latest.completedAt.getTime() < now.getTime() - staleMs
            ? "UNKNOWN"
            : (latest.healthState ?? "UNKNOWN");
        return {
          id: t.id,
          name: t.name,
          health,
          averageMs: mean.get(t.id) ?? null,
        };
      });
      const incidentWhere: Prisma.IncidentWhereInput = {
        organizationId: c.organizationId,
        test: s.test,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      };
      const [openIncidents, incidents] = await Promise.all([
        tx.incident.count({
          where: { ...incidentWhere, state: { not: "RESOLVED" } },
        }),
        tx.incident.findMany({
          where: {
            ...incidentWhere,
            AND: [
              {
                OR: [
                  { state: { not: "RESOLVED" } },
                  { openedAt: { gte: since } },
                ],
              },
            ],
          },
          select: {
            id: true,
            state: true,
            openedAt: true,
            test: { select: { name: true } },
          },
          orderBy: { openedAt: "desc" },
          take: 10,
        }),
      ]);
      return {
        name: s.name,
        range,
        generatedAt: now,
        summary: summary!,
        health: (
          ["HEALTHY", "DEGRADED", "DOWN", "PAUSED", "UNKNOWN"] as const
        ).map((state) => ({
          state,
          count: endpoints.filter((e) => e.health === state).length,
        })),
        errors,
        degraded: endpoints
          .filter((e) => e.health === "DEGRADED" || e.health === "DOWN")
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, 10),
        slowest: endpoints
          .filter((e) => e.averageMs !== null)
          .sort((a, b) => b.averageMs! - a.averageMs!)
          .slice(0, 10),
        openIncidents,
        incidents: incidents.map((i) => ({
          id: i.id,
          state: i.state,
          openedAt: i.openedAt,
          testName: i.test.name,
        })),
      };
    });
  }
}
