import type { MembershipRole, Prisma, PrismaClient } from "@prisma/client";
import {
  actorSchema,
  tenantContextSchema,
  type Actor,
  type TenantContext,
} from "@monitorx/contracts";

export class WorkspaceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const notFound = (): WorkspaceError =>
  new WorkspaceError(404, "NOT_FOUND", "Resource not found.");
export const forbidden = (): WorkspaceError =>
  new WorkspaceError(
    403,
    "FORBIDDEN",
    "You do not have permission for this action.",
  );
export const conflict = (): WorkspaceError =>
  new WorkspaceError(
    409,
    "CONFLICT",
    "The requested change conflicts with existing data.",
  );
export type Permission = "read" | "edit" | "manage" | "owner";
export const permits = (
  role: MembershipRole,
  permission: Permission,
): boolean =>
  permission === "read" ||
  (permission === "edit" && ["OWNER", "ADMIN", "EDITOR"].includes(role)) ||
  role === "OWNER" ||
  (permission === "manage" && role === "ADMIN");
export function canManageRole(
  actor: MembershipRole,
  target: MembershipRole,
): boolean {
  return (
    actor === "OWNER" ||
    (actor === "ADMIN" && (target === "EDITOR" || target === "VIEWER"))
  );
}
export const contextActor = (context: TenantContext): Actor => ({
  userId: context.userId,
  requestId: context.requestId,
});
export class TenantAccess {
  constructor(readonly db: PrismaClient) {}
  transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction(work, { maxWait: 10000, timeout: 15000 });
  }
  async actor(tx: Prisma.TransactionClient, raw: Actor): Promise<Actor> {
    const actor = actorSchema.parse(raw);
    const user = await tx.user.findFirst({
      where: {
        id: actor.userId,
        status: "ACTIVE",
        emailVerifiedAt: { not: null },
      },
      select: { id: true },
    });
    if (!user)
      throw new WorkspaceError(
        401,
        "AUTHENTICATION_FAILED",
        "Unable to authenticate.",
      );
    return actor;
  }
  async scoped<T>(
    raw: TenantContext,
    permission: Permission,
    work: (
      tx: Prisma.TransactionClient,
      context: TenantContext,
      role: MembershipRole,
    ) => Promise<T>,
  ): Promise<T> {
    const context = tenantContextSchema.parse(raw);
    return this.transaction(async (tx) => {
      await this.actor(tx, contextActor(context));
      // Serialize authorization and writes with role changes and last-owner checks.
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${context.organizationId}::uuid FOR UPDATE`;
      const membership = await tx.membership.findFirst({
        where: {
          organizationId: context.organizationId,
          userId: context.userId,
          status: "ACTIVE",
        },
      });
      if (!membership) throw notFound();
      if (!permits(membership.role, permission)) throw forbidden();
      return work(tx, context, membership.role);
    });
  }
}
export async function tenantAudit(
  tx: Prisma.TransactionClient,
  context: TenantContext,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: {
    role?: MembershipRole;
    keyVersion?: number;
    revision?: number;
    changedFields?: string[];
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      requestId: context.requestId,
      action,
      entityType,
      entityId,
      ...(metadata ? { metadata } : {}),
    },
  });
}
