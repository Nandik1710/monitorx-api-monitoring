import {
  organizationCreateSchema,
  organizationUpdateSchema,
  memberChangeSchema,
  resourceIdSchema,
  pageSchema,
  type Actor,
  type TenantContext,
} from "@monitorx/contracts";
import {
  type TenantAccess,
  tenantAudit,
  canManageRole,
  forbidden,
  notFound,
  conflict,
} from "./tenant-access.js";

export class OrganizationService {
  constructor(private readonly access: TenantAccess) {}
  create(actor: Actor, raw: unknown) {
    const input = organizationCreateSchema.parse(raw);
    return this.access.transaction(async (tx) => {
      await this.access.actor(tx, actor);
      const organization = await tx.organization.create({ data: input });
      await tx.membership.create({
        data: {
          organizationId: organization.id,
          userId: actor.userId,
          role: "OWNER",
          status: "ACTIVE",
          acceptedAt: new Date(),
        },
      });
      await tenantAudit(
        tx,
        { ...actor, organizationId: organization.id },
        "organization.created",
        "Organization",
        organization.id,
      );
      return { ...organization, role: "OWNER" as const };
    });
  }
  listForUser(actor: Actor, rawPage: unknown = {}) {
    const page = pageSchema.parse(rawPage);
    return this.access.transaction(async (tx) => {
      await this.access.actor(tx, actor);
      const memberships = await tx.membership.findMany({
        where: { userId: actor.userId, status: "ACTIVE" },
        include: { organization: true },
        orderBy: { id: "asc" },
        skip: (page.page - 1) * page.limit,
        take: page.limit,
      });
      return memberships.map((item) => ({
        ...item.organization,
        role: item.role,
      }));
    });
  }
  get(context: TenantContext) {
    return this.access.scoped(context, "read", async (tx, ctx, role) => ({
      ...(await tx.organization.findFirstOrThrow({
        where: { id: ctx.organizationId },
      })),
      role,
    }));
  }
  update(context: TenantContext, raw: unknown) {
    const data = organizationUpdateSchema.parse(raw);
    return this.access.scoped(context, "owner", async (tx, ctx) => {
      const result = await tx.organization.update({
        where: { id: ctx.organizationId },
        data,
      });
      await tenantAudit(
        tx,
        ctx,
        "organization.updated",
        "Organization",
        result.id,
      );
      return result;
    });
  }
  members(context: TenantContext, rawPage: unknown = {}) {
    const page = pageSchema.parse(rawPage);
    return this.access.scoped(context, "manage", (tx, ctx) =>
      tx.membership.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: { not: "REMOVED" },
        },
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          user: { select: { displayName: true, email: true } },
        },
        orderBy: { id: "asc" },
        take: page.limit,
        skip: (page.page - 1) * page.limit,
      }),
    );
  }
  changeRole(context: TenantContext, userId: string, raw: unknown) {
    const role = memberChangeSchema.parse(raw).role;
    return this.mutateMember(context, resourceIdSchema.parse(userId), role);
  }
  removeMember(context: TenantContext, userId: string) {
    return this.mutateMember(context, resourceIdSchema.parse(userId));
  }
  private mutateMember(
    context: TenantContext,
    userId: string,
    role?: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER",
  ) {
    return this.access.scoped(context, "manage", async (tx, ctx, actorRole) => {
      const member = await tx.membership.findFirst({
        where: { organizationId: ctx.organizationId, userId, status: "ACTIVE" },
        include: { user: { select: { email: true } } },
      });
      if (!member) throw notFound();
      if (
        !canManageRole(actorRole, member.role) ||
        (role && !canManageRole(actorRole, role))
      )
        throw forbidden();
      if (member.role === "OWNER" && role !== "OWNER") {
        const count = await tx.membership.count({
          where: {
            organizationId: ctx.organizationId,
            role: "OWNER",
            status: "ACTIVE",
            user: { status: "ACTIVE", emailVerifiedAt: { not: null } },
          },
        });
        if (count <= 1) throw conflict();
      }
      await tx.membership.updateMany({
        where: { organizationId: ctx.organizationId, userId },
        data: role ? { role } : { status: "REMOVED" },
      });
      await tx.organizationInvitation.updateMany({
        where: {
          organizationId: ctx.organizationId,
          email: member.user.email,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await tenantAudit(
        tx,
        ctx,
        role ? "membership.role_changed" : "membership.removed",
        "Membership",
        member.id,
        role ? { role } : undefined,
      );
      return {
        userId,
        role: role ?? member.role,
        status: role ? "ACTIVE" : "REMOVED",
      };
    });
  }
}
