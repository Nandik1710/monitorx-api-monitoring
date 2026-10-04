import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { inMaintenance, monitorScheduleSchema } from "@monitorx/contracts";
import { nextScheduleTime, snapshotTest, executionEvent } from "@monitorx/db";

export class Scheduler {
  readonly metrics = { reconciled: 0, missed: 0, lastLagMs: 0, errors: 0 };
  constructor(private readonly db: PrismaClient) {}
  async reconcile(now = new Date()): Promise<number> {
    const result = await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(73423)::text`;
        const due = await tx.schedule.findMany({
          where: {
            enabled: true,
            pausedAt: null,
            nextRunAt: { lte: new Date(now.getTime() + 60000) },
            environmentId: { not: null },
            createdById: { not: null },
          },
          orderBy: { nextRunAt: "asc" },
          take: 100,
          include: { test: true },
        });
        let created = 0,
          missed = 0,
          lag = 0;
        for (const pending of due) {
          // Serialize with API pause/edit and worker authorization using the tenant lock.
          await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id"=${pending.organizationId}::uuid FOR UPDATE`;
          const schedule = await tx.schedule.findUniqueOrThrow({
            where: { id: pending.id },
            include: { test: true },
          });
          const fresh = schedule;
          if (
            !fresh.enabled ||
            fresh.pausedAt ||
            !fresh.nextRunAt ||
            fresh.nextRunAt.getTime() !== pending.nextRunAt!.getTime()
          )
            continue;
          const configured = monitorScheduleSchema.safeParse({
            testId: schedule.testId,
            environmentId: schedule.environmentId,
            cadence: schedule.cadence,
            intervalMinutes: schedule.intervalMinutes ?? 5,
            hour: schedule.hour,
            minute: schedule.minute,
            timeZone: schedule.timeZone,
            enabled: schedule.enabled,
            paused: false,
            maintenanceWindows: schedule.maintenanceWindows,
            failureThreshold: schedule.failureThreshold,
            recoveryThreshold: schedule.recoveryThreshold,
          });
          if (!configured.success) {
            await tx.schedule.update({
              where: { id: schedule.id },
              data: { pausedAt: now, nextRunAt: null },
            });
            continue;
          }
          const scheduledAt = fresh.nextRunAt;
          const behind = Math.max(0, now.getTime() - scheduledAt.getTime());
          lag = Math.max(lag, behind);
          if (behind > 60000) missed++;
          const logicalKey = createHash("sha256")
            .update(`${schedule.testId}|${scheduledAt.toISOString()}|SCHEDULED`)
            .digest("hex");
          const existing = await tx.execution.findUnique({
            where: {
              testId_scheduledAt_runKind: {
                testId: schedule.testId,
                scheduledAt,
                runKind: "SCHEDULED",
              },
            },
          });
          if (!existing) {
            const paused =
              !schedule.test.enabled ||
              inMaintenance(schedule.maintenanceWindows, scheduledAt) ||
              inMaintenance(schedule.maintenanceWindows, now);
            let configSnapshot: Prisma.InputJsonValue | undefined;
            let invalid = false;
            try {
              if (!paused)
                configSnapshot = await snapshotTest(
                  tx,
                  schedule.organizationId,
                  schedule.test,
                  schedule.environmentId!,
                );
            } catch {
              invalid = true;
            }
            const row = await tx.execution.create({
              data: {
                organizationId: schedule.organizationId,
                testId: schedule.testId,
                scheduleId: schedule.id,
                environmentId: schedule.environmentId,
                requestedById: schedule.createdById,
                runKind: "SCHEDULED",
                scheduledAt,
                logicalKey,
                availableAt: scheduledAt,
                status: paused ? "CANCELLED" : invalid ? "FAILED" : "QUEUED",
                healthState: paused ? "PAUSED" : "UNKNOWN",
                configSnapshot,
                completedAt: paused || invalid ? now : null,
                errorClass: invalid ? "configuration_error" : null,
                errorMessage: invalid
                  ? "Scheduled configuration unavailable."
                  : null,
                expiresAt: new Date(now.getTime() + 90 * 86400000),
              },
            });
            await executionEvent(
              tx,
              schedule.organizationId,
              row.id,
              paused || invalid ? "execution.completed" : "execution.queued",
            );
            created++;
          }
          // One catch-up slot only, then advance beyond now; never replay an unbounded outage backlog.
          await tx.schedule.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: scheduledAt,
              nextRunAt: nextScheduleTime(
                configured.data,
                scheduledAt > now ? scheduledAt : now,
              ),
            },
          });
        }
        return { created, missed, lag };
      },
      { maxWait: 10000, timeout: 30000 },
    );
    this.metrics.reconciled += result.created;
    this.metrics.missed += result.missed;
    this.metrics.lastLagMs = result.lag;
    return result.created;
  }
}
