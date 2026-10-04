import {
  inviteCreateSchema,
  inviteAcceptSchema,
  resourceIdSchema,
  pageSchema,
  type Actor,
  type TenantContext,
} from "@monitorx/contracts";
import { newToken, tokenHash } from "@monitorx/security";
import {
  type TenantAccess,
  tenantAudit,
  canManageRole,
  forbidden,
  notFound,
  conflict,
  WorkspaceError,
} from "./tenant-access.js";

export interface InvitationMailer {
  sendInvitation(
    email: string,
    organizationId: string,
    token: string,
  ): Promise<void>;
}
const inviteSelect = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;
export class InvitationService {
  constructor(
    private readonly access: TenantAccess,
    private readonly mailer: InvitationMailer,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  list(context: TenantContext, rawPage: unknown = {}) {
    const page = pageSchema.parse(rawPage);
    return this.access.scoped(context, "manage", (tx, ctx) =>
      tx.organizationInvitation.findMany({
        where: { organizationId: ctx.organizationId },
        select: inviteSelect,
        orderBy: { id: "asc" },
        skip: (page.page - 1) * page.limit,
        take: page.limit,
      }),
    );
  }
  async create(context: TenantContext, raw: unknown) {
    const input = inviteCreateSchema.parse(raw);
    const token = newToken();
    const result = await this.access.scoped(
      context,
      "manage",
      async (tx, ctx, role) => {
        if (!canManageRole(role, input.role)) throw forbidden();
        const existing = await tx.membership.findFirst({
          where: {
            organizationId: ctx.organizationId,
            user: { email: input.email },
          },
        });
        if (existing && !canManageRole(role, existing.role)) throw forbidden();
        if (existing?.status === "ACTIVE") throw conflict();
        const pending = await tx.organizationInvitation.findMany({
          where: {
            organizationId: ctx.organizationId,
            email: input.email,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: this.clock() },
          },
          select: { role: true },
        });
        if (pending.some((invite) => !canManageRole(role, invite.role)))
          throw forbidden();
        await tx.organizationInvitation.updateMany({
          where: {
            organizationId: ctx.organizationId,
            email: input.email,
            acceptedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: this.clock() },
        });
        const invitation = await tx.organizationInvitation.create({
          data: {
            organizationId: ctx.organizationId,
            invitedById: ctx.userId,
            email: input.email,
            role: input.role,
            tokenHash: tokenHash(token),
            expiresAt: new Date(this.clock().getTime() + 7 * 24 * 60 * 60_000),
          },
          select: inviteSelect,
        });
        await tenantAudit(
          tx,
          ctx,
          "invitation.created",
          "OrganizationInvitation",
          invitation.id,
          { role: input.role },
        );
        return invitation;
      },
    );
    try {
      await this.mailer.sendInvitation(
        input.email,
        context.organizationId,
        token,
      );
    } catch {
      // Revoke this delivery's token only; never revoke a newer resend.
      await this.access.transaction(async (tx) => {
        await tx.organizationInvitation.updateMany({
          where: {
            id: result.id,
            organizationId: context.organizationId,
            acceptedAt: null,
          },
          data: { revokedAt: this.clock() },
        });
        await tenantAudit(
          tx,
          context,
          "invitation.delivery_failed",
          "OrganizationInvitation",
          result.id,
        );
      });
      throw new WorkspaceError(
        503,
        "DELIVERY_UNAVAILABLE",
        "Invitation delivery failed. Please send a new invitation.",
      );
    }
    return result;
  }
  revoke(context: TenantContext, id: string) {
    resourceIdSchema.parse(id);
    return this.access.scoped(context, "manage", async (tx, ctx, role) => {
      const invitation = await tx.organizationInvitation.findFirst({
        where: { id, organizationId: ctx.organizationId },
      });
      if (!invitation) throw notFound();
      if (!canManageRole(role, invitation.role)) throw forbidden();
      await tx.organizationInvitation.updateMany({
        where: { id, organizationId: ctx.organizationId, acceptedAt: null },
        data: { revokedAt: this.clock() },
      });
      await tenantAudit(
        tx,
        ctx,
        "invitation.revoked",
        "OrganizationInvitation",
        id,
      );
    });
  }
  accept(actor: Actor, organizationId: string, raw: unknown) {
    resourceIdSchema.parse(organizationId);
    const { token } = inviteAcceptSchema.parse(raw);
    return this.access.transaction(async (tx) => {
      await this.access.actor(tx, actor);
      // Acceptance is the sole membership-bootstrap exception: bind org, token,
      // verified recipient identity AND the inviter's current permission.
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: { email: true },
      });
      const invitation = await tx.organizationInvitation.findFirst({
        where: {
          organizationId,
          tokenHash: tokenHash(token),
          email: user.email,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: this.clock() },
        },
      });
      if (!invitation) throw notFound();
      const inviter = await tx.membership.findFirst({
        where: {
          organizationId,
          userId: invitation.invitedById,
          status: "ACTIVE",
          user: { status: "ACTIVE", emailVerifiedAt: { not: null } },
        },
      });
      if (!inviter || !canManageRole(inviter.role, invitation.role))
        throw notFound();
      const existing = await tx.membership.findFirst({
        where: { organizationId, userId: actor.userId },
      });
      if (existing && !canManageRole(inviter.role, existing.role))
        throw notFound();
      if (existing?.status === "ACTIVE") throw conflict();
      await tx.organizationInvitation.updateMany({
        where: { id: invitation.id, organizationId },
        data: { acceptedAt: this.clock() },
      });
      await tx.membership.upsert({
        where: {
          organizationId_userId: { organizationId, userId: actor.userId },
        },
        create: {
          organizationId,
          userId: actor.userId,
          role: invitation.role,
          status: "ACTIVE",
          acceptedAt: this.clock(),
        },
        update: {
          role: invitation.role,
          status: "ACTIVE",
          acceptedAt: this.clock(),
        },
      });
      await tenantAudit(
        tx,
        { ...actor, organizationId },
        "invitation.accepted",
        "OrganizationInvitation",
        invitation.id,
        { role: invitation.role },
      );
      return { organizationId, role: invitation.role };
    });
  }
}
