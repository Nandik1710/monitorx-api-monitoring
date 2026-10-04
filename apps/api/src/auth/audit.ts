import type { Prisma, PrismaClient } from "@prisma/client";
export type Store = Prisma.TransactionClient | PrismaClient;
export async function audit(
  db: Store,
  action: string,
  requestId: string,
  actorUserId?: string,
): Promise<void> {
  // Deliberately allow-list fields: never record addresses, passwords, tokens, or request bodies.
  await db.auditLog.create({
    data: {
      action: `auth.${action}`,
      requestId,
      ...(actorUserId ? { actorUserId } : {}),
    },
  });
}
