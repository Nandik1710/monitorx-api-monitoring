import {
  projectCreateSchema,
  projectUpdateSchema,
  resourceIdSchema,
  pageSchema,
  type TenantContext,
} from "@monitorx/contracts";
import {
  type TenantAccess,
  tenantAudit,
  notFound,
  conflict,
} from "./tenant-access.js";

export class ProjectService {
  constructor(private readonly access: TenantAccess) {}
  list(context: TenantContext, rawPage: unknown = {}) {
    const page = pageSchema.parse(rawPage);
    return this.access.scoped(context, "read", (tx, ctx) =>
      tx.project.findMany({
        where: { organizationId: ctx.organizationId, archivedAt: null },
        orderBy: { id: "asc" },
        skip: (page.page - 1) * page.limit,
        take: page.limit,
      }),
    );
  }
  get(context: TenantContext, id: string) {
    resourceIdSchema.parse(id);
    return this.access.scoped(context, "read", async (tx, ctx) => {
      const project = await tx.project.findFirst({
        where: { id, organizationId: ctx.organizationId, archivedAt: null },
      });
      if (!project) throw notFound();
      return project;
    });
  }
  create(context: TenantContext, raw: unknown) {
    const input = projectCreateSchema.parse(raw);
    return this.access.scoped(context, "manage", async (tx, ctx) => {
      const project = await tx.project.create({
        data: { ...input, organizationId: ctx.organizationId },
      });
      await tenantAudit(tx, ctx, "project.created", "Project", project.id);
      return project;
    });
  }
  update(context: TenantContext, id: string, raw: unknown) {
    resourceIdSchema.parse(id);
    const input = projectUpdateSchema.parse(raw);
    return this.access.scoped(context, "manage", async (tx, ctx) => {
      const count = await tx.project.updateMany({
        where: { id, organizationId: ctx.organizationId, archivedAt: null },
        data: input,
      });
      if (!count.count) throw notFound();
      await tenantAudit(tx, ctx, "project.updated", "Project", id);
      return tx.project.findFirstOrThrow({
        where: { id, organizationId: ctx.organizationId },
      });
    });
  }
  remove(context: TenantContext, id: string) {
    resourceIdSchema.parse(id);
    return this.access.scoped(context, "manage", async (tx, ctx) => {
      const project = await tx.project.findFirst({
        where: { id, organizationId: ctx.organizationId },
      });
      if (!project) throw notFound();
      const where = { organizationId: ctx.organizationId, projectId: id };
      if (
        (await tx.environment.count({ where })) ||
        (await tx.collection.count({ where })) ||
        (await tx.apiTest.count({ where }))
      )
        throw conflict();
      await tx.project.deleteMany({
        where: { id, organizationId: ctx.organizationId },
      });
      await tenantAudit(tx, ctx, "project.deleted", "Project", id);
    });
  }
}
