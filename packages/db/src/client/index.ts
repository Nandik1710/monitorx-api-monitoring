import { PrismaClient } from "@prisma/client";

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}

const globalForPrisma = globalThis as typeof globalThis & {
  monitorxPrisma?: PrismaClient;
};

export const prisma = globalForPrisma.monitorxPrisma ?? createPrismaClient();

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.monitorxPrisma = prisma;
}
