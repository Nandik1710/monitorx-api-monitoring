import { Prisma, type ApiTest, type Execution } from "@prisma/client";
import {
  apiTestCreateSchema,
  apiTestFieldsSchema,
  runInputSchema,
  collectionRunInputSchema,
  variablesSchema,
  requestStrings,
  templateReferences,
  credentialReferences,
  type TenantContext,
} from "@monitorx/contracts";
import {
  type TenantAccess,
  WorkspaceError,
  notFound,
  tenantAudit,
} from "./tenant-access.js";

export function runView(row: Execution) {
  return {
    id: row.id,
    testId: row.testId,
    status: row.status,
    healthState: row.healthState,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    latencyMs: row.latencyMs,
    httpStatus: row.httpStatus,
    errorClass: row.errorClass,
    cancelRequested: row.cancelRequested,
  };
}
export async function snapshotTest(
  tx: Prisma.TransactionClient,
  organizationId: string,
  test: ApiTest,
  environmentId: string,
) {
  const environment = await tx.environment.findFirst({
    where: { id: environmentId, organizationId, projectId: test.projectId },
  });
  if (!environment) throw notFound();
  const definition = apiTestCreateSchema.parse({
    ...Object.fromEntries(
      Object.keys(apiTestFieldsSchema.shape).map((key) => [
        key,
        test[key as keyof ApiTest],
      ]),
    ),
    environmentId,
    authConfig: test.authConfig ?? { type: "NONE" },
  });
  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });
  if (definition.timeoutMs > organization.testTimeoutLimitMs)
    throw new WorkspaceError(
      400,
      "VALIDATION_ERROR",
      "Test timeout exceeds the workspace limit.",
    );
  const variables = variablesSchema.parse(environment.variables);
  const secrets = await tx.environmentSecret.findMany({
    where: {
      organizationId,
      environmentId,
      key: { in: requestStrings(definition).flatMap(templateReferences) },
    },
    select: { key: true, ciphertext: true, keyVersion: true },
  });
  const names = secrets.map((s) => s.key);
  if (
    requestStrings(definition)
      .flatMap(templateReferences)
      .some(
        (name) => !Object.hasOwn(variables, name) && !names.includes(name),
      ) ||
    credentialReferences(definition).some((name) => !names.includes(name))
  )
    throw new WorkspaceError(
      400,
      "VALIDATION_ERROR",
      "The selected environment is missing a required variable or encrypted secret.",
    );
  return { definition, variables, secrets, revision: test.revision };
}
export async function executionEvent(
  tx: Prisma.TransactionClient,
  organizationId: string,
  executionId: string,
  type: string,
) {
  await tx.executionEvent.create({
    data: { organizationId, executionId, type },
  });
}
export class RunService {
  constructor(private readonly access: TenantAccess) {}
  submit(ctx: TenantContext, testId: string, raw: unknown) {
    const { environmentId } = runInputSchema.parse(raw);
    return this.access.scoped(ctx, "edit", async (tx, context) => {
      const test = await tx.apiTest.findFirst({
        where: {
          id: testId,
          organizationId: context.organizationId,
          project: { archivedAt: null },
        },
      });
      if (!test) throw notFound();
      const configSnapshot = await snapshotTest(
        tx,
        context.organizationId,
        test,
        environmentId,
      );
      const row = await tx.execution.create({
        data: {
          organizationId: context.organizationId,
          testId,
          environmentId,
          requestedById: context.userId,
          configSnapshot,
          expiresAt: new Date(Date.now() + 90 * 86400000),
        },
      });
      await executionEvent(
        tx,
        context.organizationId,
        row.id,
        "execution.queued",
      );
      await tenantAudit(tx, context, "execution.queued", "Execution", row.id);
      return { runId: row.id, ...runView(row) };
    });
  }
  submitCollection(ctx: TenantContext, collectionId: string, raw: unknown) {
    const input = collectionRunInputSchema.parse(raw);
    return this.access.scoped(ctx, "edit", async (tx, context) => {
      const collection = await tx.collection.findFirst({
        where: {
          id: collectionId,
          organizationId: context.organizationId,
          project: { archivedAt: null },
        },
      });
      if (!collection) throw notFound();
      const tests = await tx.apiTest.findMany({
        where: { collectionId, organizationId: context.organizationId },
        orderBy: { id: "asc" },
        take: 101,
      });
      if (!tests.length || tests.length > 100)
        throw new WorkspaceError(
          400,
          "VALIDATION_ERROR",
          "Collection runs require between 1 and 100 tests.",
        );
      const snapshots = await Promise.all(
        tests.map((test) =>
          snapshotTest(tx, context.organizationId, test, input.environmentId),
        ),
      );
      const group = await tx.collectionRun.create({
        data: {
          ...input,
          organizationId: context.organizationId,
          collectionId,
          projectId: collection.projectId,
          requestedById: context.userId,
        },
      });
      for (const [i, test] of tests.entries()) {
        const row = await tx.execution.create({
          data: {
            organizationId: context.organizationId,
            testId: test.id,
            environmentId: input.environmentId,
            requestedById: context.userId,
            collectionRunId: group.id,
            runKind: "COLLECTION",
            configSnapshot: snapshots[i]!,
            expiresAt: new Date(Date.now() + 90 * 86400000),
          },
        });
        await executionEvent(
          tx,
          context.organizationId,
          row.id,
          "execution.queued",
        );
      }
      await tenantAudit(
        tx,
        context,
        "collection.run_queued",
        "CollectionRun",
        group.id,
      );
      return {
        runId: group.id,
        count: tests.length,
        parallelism: group.parallelism,
      };
    });
  }
  get(ctx: TenantContext, id: string) {
    return this.access.scoped(ctx, "read", async (tx, context) => {
      const row = await tx.execution.findFirst({
        where: { id, organizationId: context.organizationId },
      });
      if (!row) throw notFound();
      return runView(row);
    });
  }
  group(ctx: TenantContext, id: string) {
    return this.access.scoped(ctx, "read", async (tx, context) => {
      const row = await tx.collectionRun.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { executions: { orderBy: { createdAt: "asc" }, take: 100 } },
      });
      if (!row) throw notFound();
      return {
        id: row.id,
        cancelledAt: row.cancelledAt,
        executions: row.executions.map(runView),
      };
    });
  }
  cancel(ctx: TenantContext, id: string, group = false) {
    return this.access.scoped(ctx, "edit", async (tx, context) => {
      const scope = { organizationId: context.organizationId };
      if (group) {
        if (!(await tx.collectionRun.findFirst({ where: { id, ...scope } })))
          throw notFound();
        await tx.collectionRun.update({
          where: { id },
          data: { cancelledAt: new Date() },
        });
      } else if (!(await tx.execution.findFirst({ where: { id, ...scope } })))
        throw notFound();
      const where = {
        ...scope,
        ...(group ? { collectionRunId: id } : { id }),
        status: { in: ["QUEUED", "RUNNING"] as ("QUEUED" | "RUNNING")[] },
      };
      const queued = await tx.execution.findMany({
        where: { ...where, status: "QUEUED" },
        select: { id: true },
      });
      await tx.execution.updateMany({ where, data: { cancelRequested: true } });
      await tx.execution.updateMany({
        where: { ...where, status: "QUEUED" },
        data: {
          status: "CANCELLED",
          healthState: "UNKNOWN",
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
      await tenantAudit(
        tx,
        context,
        "execution.cancel_requested",
        group ? "CollectionRun" : "Execution",
        id,
      );
      return { cancelled: true };
    });
  }
}
