import type { Prisma } from "@prisma/client";
import {
  workspaceEnvironmentCreateSchema,
  workspaceEnvironmentUpdateSchema,
  resourceIdSchema,
  pageSchema,
  secretWriteSchema,
  variableNameSchema,
  type TenantContext,
} from "@monitorx/contracts";
import type { TenantEncryption } from "@monitorx/security";
import {
  type TenantAccess,
  tenantAudit,
  notFound,
  conflict,
} from "./tenant-access.js";

const secretSelect = {
  id: true,
  key: true,
  keyVersion: true,
  createdAt: true,
  updatedAt: true,
} as const;
const masked = <T>(record: T): T & { maskedValue: "••••••••" } => ({
  ...record,
  maskedValue: "••••••••",
});
export class EnvironmentService {
  constructor(
    private readonly access: TenantAccess,
    private readonly encryption: TenantEncryption,
  ) {}
  private async environment(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    id: string,
  ) {
    const environment = await tx.environment.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
        project: { archivedAt: null },
      },
    });
    if (!environment) throw notFound();
    return environment;
  }
  list(context: TenantContext, projectId: string, rawPage: unknown = {}) {
    resourceIdSchema.parse(projectId);
    const page = pageSchema.parse(rawPage);
    return this.access.scoped(context, "read", async (tx, ctx) => {
      if (
        !(await tx.project.findFirst({
          where: {
            id: projectId,
            organizationId: ctx.organizationId,
            archivedAt: null,
          },
        }))
      )
        throw notFound();
      return tx.environment.findMany({
        where: { organizationId: ctx.organizationId, projectId },
        orderBy: { id: "asc" },
        skip: (page.page - 1) * page.limit,
        take: page.limit,
      });
    });
  }
  get(context: TenantContext, id: string) {
    resourceIdSchema.parse(id);
    return this.access.scoped(context, "read", (tx, ctx) =>
      this.environment(tx, ctx, id),
    );
  }
  create(context: TenantContext, projectId: string, raw: unknown) {
    resourceIdSchema.parse(projectId);
    const input = workspaceEnvironmentCreateSchema.parse(raw);
    return this.access.scoped(context, "manage", async (tx, ctx) => {
      if (
        !(await tx.project.findFirst({
          where: {
            id: projectId,
            organizationId: ctx.organizationId,
            archivedAt: null,
          },
        }))
      )
        throw notFound();
      const result = await tx.environment.create({
        data: { ...input, projectId, organizationId: ctx.organizationId },
      });
      await tenantAudit(
        tx,
        ctx,
        "environment.created",
        "Environment",
        result.id,
      );
      return result;
    });
  }
  update(context: TenantContext, id: string, raw: unknown) {
    resourceIdSchema.parse(id);
    const input = workspaceEnvironmentUpdateSchema.parse(raw);
    return this.access.scoped(context, "manage", async (tx, ctx) => {
      await this.environment(tx, ctx, id);
      if (
        input.variables &&
        (await tx.environmentSecret.count({
          where: {
            organizationId: ctx.organizationId,
            environmentId: id,
            key: { in: Object.keys(input.variables) },
          },
        }))
      )
        throw conflict();
      await tx.environment.updateMany({
        where: { id, organizationId: ctx.organizationId },
        data: input,
      });
      await tenantAudit(tx, ctx, "environment.updated", "Environment", id);
      return this.environment(tx, ctx, id);
    });
  }
  remove(context: TenantContext, id: string) {
    resourceIdSchema.parse(id);
    return this.access.scoped(context, "manage", async (tx, ctx) => {
      await this.environment(tx, ctx, id);
      const where = { organizationId: ctx.organizationId, environmentId: id };
      if (
        (await tx.apiTest.count({ where })) ||
        (await tx.execution.count({ where })) ||
        (await tx.incident.count({ where }))
      )
        throw conflict();
      const secrets = await tx.environmentSecret.findMany({
        where,
        select: { id: true },
      });
      for (const secret of secrets)
        await tenantAudit(
          tx,
          ctx,
          "secret.deleted",
          "EnvironmentSecret",
          secret.id,
        );
      await tx.environment.deleteMany({
        where: { id, organizationId: ctx.organizationId },
      });
      await tenantAudit(tx, ctx, "environment.deleted", "Environment", id);
    });
  }
  secrets(context: TenantContext, id: string, rawPage: unknown = {}) {
    resourceIdSchema.parse(id);
    const page = pageSchema.parse(rawPage);
    return this.access.scoped(context, "read", async (tx, ctx) => {
      await this.environment(tx, ctx, id);
      const rows = await tx.environmentSecret.findMany({
        where: { organizationId: ctx.organizationId, environmentId: id },
        select: secretSelect,
        orderBy: { key: "asc" },
        skip: (page.page - 1) * page.limit,
        take: page.limit,
      });
      return rows.map(masked);
    });
  }
  writeSecret(
    context: TenantContext,
    id: string,
    rawName: string,
    raw: unknown,
  ) {
    resourceIdSchema.parse(id);
    const key = variableNameSchema.parse(rawName);
    const input = secretWriteSchema.parse(raw);
    return this.access.scoped(context, "manage", async (tx, ctx) => {
      const environment = await this.environment(tx, ctx, id);
      if (
        typeof environment.variables === "object" &&
        environment.variables !== null &&
        Object.hasOwn(environment.variables, key)
      )
        throw conflict();
      const existing = await tx.environmentSecret.findFirst({
        where: { organizationId: ctx.organizationId, environmentId: id, key },
        select: { id: true },
      });
      if (
        !existing &&
        (await tx.environmentSecret.count({
          where: { organizationId: ctx.organizationId, environmentId: id },
        })) >= 100
      )
        throw conflict();
      const encrypted = await this.encryption.encrypt(input.value, {
        organizationId: ctx.organizationId,
        environmentId: id,
        name: key,
      });
      if (existing) {
        await tx.environmentSecret.updateMany({
          where: {
            id: existing.id,
            organizationId: ctx.organizationId,
            environmentId: id,
          },
          data: encrypted,
        });
      } else {
        await tx.environmentSecret.create({
          data: {
            organizationId: ctx.organizationId,
            environmentId: id,
            key,
            ...encrypted,
          },
        });
      }
      const result = await tx.environmentSecret.findFirstOrThrow({
        where: { organizationId: ctx.organizationId, environmentId: id, key },
        select: secretSelect,
      });
      await tenantAudit(
        tx,
        ctx,
        existing ? "secret.updated" : "secret.created",
        "EnvironmentSecret",
        result.id,
        { keyVersion: result.keyVersion },
      );
      return masked(result);
    });
  }
  removeSecret(context: TenantContext, id: string, rawName: string) {
    resourceIdSchema.parse(id);
    const key = variableNameSchema.parse(rawName);
    return this.access.scoped(context, "manage", async (tx, ctx) => {
      await this.environment(tx, ctx, id);
      const secret = await tx.environmentSecret.findFirst({
        where: { organizationId: ctx.organizationId, environmentId: id, key },
        select: { id: true },
      });
      if (!secret) throw notFound();
      await tx.environmentSecret.deleteMany({
        where: {
          id: secret.id,
          organizationId: ctx.organizationId,
          environmentId: id,
        },
      });
      await tenantAudit(
        tx,
        ctx,
        "secret.deleted",
        "EnvironmentSecret",
        secret.id,
      );
    });
  }
  rotateSecret(context: TenantContext, id: string, rawName: string) {
    resourceIdSchema.parse(id);
    const key = variableNameSchema.parse(rawName);
    return this.access.scoped(context, "manage", async (tx, ctx) => {
      await this.environment(tx, ctx, id);
      const secret = await tx.environmentSecret.findFirst({
        where: { organizationId: ctx.organizationId, environmentId: id, key },
      });
      if (!secret) throw notFound();
      const binding = {
        organizationId: ctx.organizationId,
        environmentId: id,
        name: key,
      };
      const value = await this.encryption.decrypt(secret, binding);
      const encrypted = await this.encryption.encrypt(value, binding);
      await tx.environmentSecret.updateMany({
        where: {
          id: secret.id,
          organizationId: ctx.organizationId,
          environmentId: id,
        },
        data: encrypted,
      });
      await tenantAudit(
        tx,
        ctx,
        "secret.key_rotated",
        "EnvironmentSecret",
        secret.id,
        { keyVersion: encrypted.keyVersion },
      );
      return masked(
        await tx.environmentSecret.findFirstOrThrow({
          where: {
            id: secret.id,
            organizationId: ctx.organizationId,
            environmentId: id,
          },
          select: secretSelect,
        }),
      );
    });
  }
}
