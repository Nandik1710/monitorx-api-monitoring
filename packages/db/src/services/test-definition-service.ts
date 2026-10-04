import type { ApiTest, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  apiTestCreateSchema,
  apiTestUpdateSchema,
  apiTestFieldsSchema,
  collectionCreateSchema,
  collectionUpdateSchema,
  pageSchema,
  resourceIdSchema,
  variablesSchema,
  templateReferences,
  requestStrings,
  credentialReferences,
  previewTemplate,
  definitionErrors,
  MASK,
  REQUEST_LIMITS,
  byteLength,
  sensitiveName,
  type TestDefinition,
  type TenantContext,
} from "@monitorx/contracts";
import {
  type TenantAccess,
  WorkspaceError,
  notFound,
  conflict,
  tenantAudit,
} from "./tenant-access.js";

const collectionListSchema = pageSchema.extend({ projectId: resourceIdSchema });
const testListSchema = pageSchema.extend({ collectionId: resourceIdSchema });
function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new WorkspaceError(
      400,
      "VALIDATION_ERROR",
      definitionErrors(result.error),
    );
  return result.data;
}
async function project(
  tx: Prisma.TransactionClient,
  ctx: TenantContext,
  id: string,
) {
  const result = await tx.project.findFirst({
    where: { id, organizationId: ctx.organizationId, archivedAt: null },
  });
  if (!result) throw notFound();
  return result;
}
async function collection(
  tx: Prisma.TransactionClient,
  ctx: TenantContext,
  id: string,
) {
  const result = await tx.collection.findFirst({
    where: {
      id,
      organizationId: ctx.organizationId,
      project: { archivedAt: null },
    },
  });
  if (!result) throw notFound();
  return result;
}
function definition(row: ApiTest): TestDefinition {
  // Normalize the original no-auth seed representation without altering saved definitions.
  return parse(
    apiTestCreateSchema,
    Object.fromEntries(
      Object.keys(apiTestFieldsSchema.shape).map((key) => [
        key,
        key === "authConfig" && row.authConfig === null
          ? { type: "NONE" }
          : row[key as keyof ApiTest],
      ]),
    ),
  );
}
function view(row: ApiTest) {
  return {
    ...definition(row),
    id: row.id,
    organizationId: row.organizationId,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export class CollectionService {
  constructor(private readonly access: TenantAccess) {}
  list(ctx: TenantContext, raw: unknown) {
    const query = parse(collectionListSchema, raw);
    return this.access.scoped(ctx, "read", async (tx, context) => {
      await project(tx, context, query.projectId);
      const where = {
        organizationId: context.organizationId,
        projectId: query.projectId,
      };
      return {
        items: await tx.collection.findMany({
          where,
          orderBy: { id: "asc" },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        total: await tx.collection.count({ where }),
        page: query.page,
        limit: query.limit,
      };
    });
  }
  get(ctx: TenantContext, id: string) {
    resourceIdSchema.parse(id);
    return this.access.scoped(ctx, "read", (tx, context) =>
      collection(tx, context, id),
    );
  }
  create(ctx: TenantContext, raw: unknown) {
    const input = parse(collectionCreateSchema, raw);
    return this.access.scoped(ctx, "edit", async (tx, context) => {
      await project(tx, context, input.projectId);
      const result = await tx.collection.create({
        data: { ...input, organizationId: context.organizationId },
      });
      await tenantAudit(
        tx,
        context,
        "collection.created",
        "Collection",
        result.id,
      );
      return result;
    });
  }
  update(ctx: TenantContext, id: string, raw: unknown) {
    resourceIdSchema.parse(id);
    const input = parse(collectionUpdateSchema, raw);
    return this.access.scoped(ctx, "edit", async (tx, context) => {
      await collection(tx, context, id);
      await tx.collection.updateMany({
        where: { id, organizationId: context.organizationId },
        data: input,
      });
      await tenantAudit(tx, context, "collection.updated", "Collection", id);
      return collection(tx, context, id);
    });
  }
  remove(ctx: TenantContext, id: string) {
    resourceIdSchema.parse(id);
    return this.access.scoped(ctx, "edit", async (tx, context) => {
      await collection(tx, context, id);
      if (
        await tx.apiTest.count({
          where: { organizationId: context.organizationId, collectionId: id },
        })
      )
        throw new WorkspaceError(
          409,
          "CONFLICT",
          "Delete the collection's tests before deleting the collection.",
        );
      await tx.collection.deleteMany({
        where: { id, organizationId: context.organizationId },
      });
      await tenantAudit(tx, context, "collection.deleted", "Collection", id);
    });
  }
}

export class TestDefinitionService {
  constructor(private readonly access: TenantAccess) {}
  private async row(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    id: string,
  ) {
    const result = await tx.apiTest.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        project: { archivedAt: null },
      },
    });
    if (!result) throw notFound();
    return result;
  }
  private async validate(
    tx: Prisma.TransactionClient,
    ctx: TenantContext,
    input: TestDefinition,
  ) {
    await project(tx, ctx, input.projectId);
    const parent = await collection(tx, ctx, input.collectionId);
    if (parent.projectId !== input.projectId) throw notFound();
    const organization = await tx.organization.findFirstOrThrow({
      where: { id: ctx.organizationId },
      select: { testTimeoutLimitMs: true },
    });
    if (input.timeoutMs > organization.testTimeoutLimitMs)
      throw new WorkspaceError(
        400,
        "VALIDATION_ERROR",
        "timeoutMs: Exceeds this workspace's timeout limit.",
      );
    let variables: Record<string, string> = {};
    let secretNames: string[] = [];
    if (input.environmentId) {
      const environment = await tx.environment.findFirst({
        where: {
          id: input.environmentId,
          organizationId: ctx.organizationId,
          projectId: input.projectId,
        },
      });
      if (!environment) throw notFound();
      variables = variablesSchema.parse(environment.variables);
      secretNames = (
        await tx.environmentSecret.findMany({
          where: {
            organizationId: ctx.organizationId,
            environmentId: input.environmentId,
          },
          select: { key: true },
        })
      ).map((secret) => secret.key);
    }
    const references = [
      ...new Set(requestStrings(input).flatMap(templateReferences)),
    ];
    if (
      references.some(
        (key) => !Object.hasOwn(variables, key) && !secretNames.includes(key),
      )
    )
      throw new WorkspaceError(
        400,
        "VALIDATION_ERROR",
        "environmentId: A referenced variable or secret is missing in the selected environment.",
      );
    if (credentialReferences(input).some((key) => !secretNames.includes(key)))
      throw new WorkspaceError(
        400,
        "VALIDATION_ERROR",
        "authConfig: Credential references must use encrypted environment secrets, not public variables.",
      );
    return { variables, secretNames };
  }
  list(ctx: TenantContext, raw: unknown) {
    const query = parse(testListSchema, raw);
    return this.access.scoped(ctx, "read", async (tx, context) => {
      await collection(tx, context, query.collectionId);
      const where = {
        organizationId: context.organizationId,
        collectionId: query.collectionId,
      };
      const rows = await tx.apiTest.findMany({
        where,
        orderBy: { id: "asc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return {
        items: rows.map(view),
        total: await tx.apiTest.count({ where }),
        page: query.page,
        limit: query.limit,
      };
    });
  }
  get(ctx: TenantContext, id: string) {
    resourceIdSchema.parse(id);
    return this.access.scoped(ctx, "read", async (tx, context) =>
      view(await this.row(tx, context, id)),
    );
  }
  create(ctx: TenantContext, raw: unknown) {
    const input = parse(apiTestCreateSchema, raw);
    return this.access.scoped(ctx, "edit", async (tx, context) => {
      await this.validate(tx, context, input);
      const result = await tx.apiTest.create({
        data: { ...input, organizationId: context.organizationId },
      });
      await tenantAudit(tx, context, "test.created", "ApiTest", result.id, {
        revision: result.revision,
        changedFields: Object.keys(input),
      });
      return view(result);
    });
  }
  update(ctx: TenantContext, id: string, raw: unknown) {
    resourceIdSchema.parse(id);
    const { expectedRevision, ...changes } = parse(apiTestUpdateSchema, raw);
    return this.access.scoped(ctx, "edit", async (tx, context) => {
      const current = await this.row(tx, context, id);
      if (current.revision !== expectedRevision)
        throw new WorkspaceError(
          409,
          "CONFLICT",
          "This test changed. Reload it before saving your changes.",
        );
      const before = definition(current);
      const input = parse(apiTestCreateSchema, { ...before, ...changes });
      await this.validate(tx, context, input);
      await tx.apiTest.updateMany({
        where: {
          id,
          organizationId: context.organizationId,
          revision: expectedRevision,
        },
        data: { ...input, revision: { increment: 1 } },
      });
      await tenantAudit(tx, context, "test.updated", "ApiTest", id, {
        revision: expectedRevision + 1,
        changedFields: (
          Object.keys(changes) as (keyof TestDefinition)[]
        ).filter(
          (key) => JSON.stringify(before[key]) !== JSON.stringify(input[key]),
        ),
      });
      return view(await this.row(tx, context, id));
    });
  }
  remove(ctx: TenantContext, id: string, raw: unknown) {
    resourceIdSchema.parse(id);
    const { expectedRevision } = parse(
      z.object({ expectedRevision: z.number().int().positive() }).strict(),
      raw,
    );
    return this.access.scoped(ctx, "edit", async (tx, context) => {
      const current = await this.row(tx, context, id);
      if (current.revision !== expectedRevision) throw conflict();
      const where = { organizationId: context.organizationId, testId: id };
      if (
        (await tx.execution.count({ where })) ||
        (await tx.schedule.count({ where })) ||
        (await tx.incident.count({ where }))
      )
        throw new WorkspaceError(
          409,
          "CONFLICT",
          "Tests with schedules, history or incidents cannot be deleted. Disable the test instead.",
        );
      await tx.apiTest.deleteMany({
        where: { id, organizationId: context.organizationId },
      });
      await tenantAudit(tx, context, "test.deleted", "ApiTest", id, {
        revision: expectedRevision,
      });
    });
  }
  preview(ctx: TenantContext, raw: unknown) {
    const input = parse(apiTestCreateSchema, raw);
    return this.access.scoped(ctx, "read", async (tx, context) => {
      const { variables, secretNames } = await this.validate(
        tx,
        context,
        input,
      );
      const render = (
        value: string,
        maxBytes: number = REQUEST_LIMITS.bodyBytes,
      ) => {
        try {
          return previewTemplate(value, variables, secretNames, maxBytes);
        } catch {
          throw new WorkspaceError(
            400,
            "VALIDATION_ERROR",
            "definition: Expanded preview exceeds its size limit.",
          );
        }
      };
      const rows = (values: TestDefinition["headerRows"]) =>
        values.map((row) => ({
          ...row,
          value:
            row.sensitive || sensitiveName(row.key)
              ? MASK
              : render(row.value, 10000),
        }));
      const result = {
        url: render(input.urlTemplate, 2048),
        queryRows: rows(input.queryRows),
        headerRows: rows(input.headerRows),
        body: input.bodyTemplate === null ? null : render(input.bodyTemplate),
        formRows: rows(input.formRows),
        auth: Object.fromEntries(
          Object.entries(input.authConfig).map(([key, value]) => [
            key,
            ["token", "password", "value"].includes(key)
              ? MASK
              : render(value, 10000),
          ]),
        ),
        variables,
        secretNames,
        notice:
          "Preview only. Secrets are never decrypted here. No request was sent; workers will validate the expanded request before execution.",
      };
      if (
        byteLength(JSON.stringify(result.headerRows)) >
          REQUEST_LIMITS.headerBytes ||
        byteLength(JSON.stringify(result)) > 524288
      )
        throw new WorkspaceError(
          400,
          "VALIDATION_ERROR",
          "definition: Expanded preview exceeds its size limit.",
        );
      return result;
    });
  }
}
