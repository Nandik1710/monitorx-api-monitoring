import { Prisma } from "@prisma/client";
import { CronExpressionParser } from "cron-parser";
import {
  monitorScheduleSchema,
  monitorScheduleUpdateSchema,
  type MonitorSchedule,
  type TenantContext,
} from "@monitorx/contracts";
import {
  type TenantAccess,
  notFound,
  WorkspaceError,
  tenantAudit,
} from "./tenant-access.js";
import { snapshotTest, executionEvent } from "./run-service.js";
export function nextScheduleTime(
  schedule: Pick<
    MonitorSchedule,
    "cadence" | "intervalMinutes" | "hour" | "minute" | "timeZone"
  >,
  after: Date,
): Date {
  if (schedule.cadence === "INTERVAL")
    return new Date(after.getTime() + schedule.intervalMinutes * 60000);
  const expression = `${schedule.minute} ${schedule.cadence === "DAILY" ? schedule.hour : "*"} * * *`;
  return CronExpressionParser.parse(expression, {
    currentDate: after,
    tz: schedule.timeZone,
  })
    .next()
    .toDate();
}
export class ScheduleService {
  constructor(private readonly access: TenantAccess) {}
  get(ctx: TenantContext, testId: string) {
    return this.access.scoped(ctx, "read", async (tx, context) => {
      if (
        !(await tx.apiTest.findFirst({
          where: { id: testId, organizationId: context.organizationId },
        }))
      )
        throw notFound();
      return tx.schedule.findFirst({
        where: { testId, organizationId: context.organizationId },
      });
    });
  }
  create(ctx: TenantContext, raw: unknown) {
    const input = monitorScheduleSchema.parse(raw);
    return this.access.scoped(ctx, "edit", async (tx, context) => {
      await this.validate(tx, context, input);
      const { paused, ...fields } = input;
      const schedule = await tx.schedule.create({
        data: {
          ...fields,
          organizationId: context.organizationId,
          createdById: context.userId,
          pausedAt: paused ? new Date() : null,
          nextRunAt:
            input.enabled && !paused
              ? nextScheduleTime(input, new Date())
              : null,
        },
      });
      await tenantAudit(
        tx,
        context,
        "schedule.created",
        "Schedule",
        schedule.id,
      );
      return schedule;
    });
  }
  update(ctx: TenantContext, id: string, raw: unknown) {
    const changes = monitorScheduleUpdateSchema.parse(raw);
    return this.access.scoped(ctx, "edit", async (tx, context) => {
      const saved = await tx.schedule.findFirst({
        where: { id, organizationId: context.organizationId },
      });
      if (!saved) throw notFound();
      const input = monitorScheduleSchema.parse({
        ...Object.fromEntries(
          Object.keys(monitorScheduleSchema.shape).map((key) => [
            key,
            key === "paused"
              ? !!saved.pausedAt
              : saved[key as keyof typeof saved],
          ]),
        ),
        ...changes,
      });
      await this.validate(tx, context, input);
      const { paused, ...fields } = input;
      const schedule = await tx.schedule.update({
        where: { id },
        data: {
          ...fields,
          createdById: context.userId,
          pausedAt: paused ? new Date() : null,
          nextRunAt:
            input.enabled && !paused
              ? nextScheduleTime(input, new Date())
              : null,
        },
      });
      const queued = await tx.execution.findMany({
        where: {
          organizationId: context.organizationId,
          scheduleId: id,
          status: "QUEUED",
        },
        select: { id: true },
      });
      await tx.execution.updateMany({
        where: {
          organizationId: context.organizationId,
          scheduleId: id,
          status: "QUEUED",
        },
        data: {
          status: "CANCELLED",
          healthState: "PAUSED",
          completedAt: new Date(),
          configSnapshot: Prisma.DbNull,
        },
      });
      for (const row of queued)
        await executionEvent(
          tx,
          context.organizationId,
          row.id,
          "execution.completed",
        );
      await tenantAudit(tx, context, "schedule.updated", "Schedule", id);
      return schedule;
    });
  }
  private async validate(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    input: MonitorSchedule,
  ) {
    const test = await tx.apiTest.findFirst({
      where: {
        id: input.testId,
        organizationId: ctx.organizationId,
        project: { archivedAt: null },
      },
    });
    if (!test) throw notFound();
    if (input.enabled && !input.paused && !test.enabled)
      throw new WorkspaceError(
        400,
        "VALIDATION_ERROR",
        "Enable and save the test before enabling its schedule.",
      );
    if (input.enabled && !input.paused)
      await snapshotTest(tx, ctx.organizationId, test, input.environmentId);
    else if (
      !(await tx.environment.findFirst({
        where: {
          id: input.environmentId,
          organizationId: ctx.organizationId,
          projectId: test.projectId,
        },
      }))
    )
      throw notFound();
  }
}
