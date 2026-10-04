import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { ExecutionProcessor } from "./execution-processor.js";
export const QUEUES = [
  "execution",
  "collection-run",
  "alerts",
  "imports",
  "maintenance",
] as const;
export function redisConnection(value: string): ConnectionOptions {
  const url = new URL(value);
  if (!["redis:", "rediss:"].includes(url.protocol))
    throw Error("Invalid Redis configuration.");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
export function createQueues(
  connection: ConnectionOptions,
  prefix = "monitorx",
) {
  return Object.fromEntries(
    QUEUES.map((name) => [
      name,
      new Queue(name, {
        connection,
        prefix,
        defaultJobOptions: {
          attempts: 4,
          backoff: { type: "exponential", delay: 500, jitter: 0.5 },
          removeOnComplete: true,
          removeOnFail: { age: 3600, count: 1000 },
        },
      }),
    ]),
  ) as Record<(typeof QUEUES)[number], Queue>;
}
export async function reconcileRuns(
  db: PrismaClient,
  queues: ReturnType<typeof createQueues>,
): Promise<number> {
  const rows = await db.execution.findMany({
    where: {
      status: "QUEUED",
      availableAt: { lte: new Date(Date.now() + 60000) },
    },
    orderBy: { availableAt: "asc" },
    take: 500,
    select: {
      id: true,
      collectionRunId: true,
      logicalKey: true,
      availableAt: true,
    },
  });
  for (const row of rows) {
    const queue = row.collectionRunId
      ? queues["collection-run"]
      : queues.execution;
    const id = row.collectionRunId ?? row.id;
    const jobId = row.collectionRunId ?? row.logicalKey ?? row.id;
    const existing = await queue.getJob(jobId);
    if (existing && (await existing.getState()) === "failed")
      await existing.retry();
    else
      await queue.add(
        "dispatch",
        { id },
        { jobId, delay: Math.max(0, row.availableAt.getTime() - Date.now()) },
      );
  }
  return rows.length;
}
export function startQueueWorkers(
  db: PrismaClient,
  queues: ReturnType<typeof createQueues>,
  processor: ExecutionProcessor,
  connection: ConnectionOptions,
  prefix = "monitorx",
  concurrency = 5,
) {
  const options = { connection, prefix, concurrency, lockDuration: 120000 };
  const execution = new Worker(
    "execution",
    async (job) => {
      const { id } = z
        .object({ id: z.string().uuid() })
        .strict()
        .parse(job.data);
      await processor.process(id);
    },
    options,
  );
  const collection = new Worker(
    "collection-run",
    async (job) => {
      const { id } = z
        .object({ id: z.string().uuid() })
        .strict()
        .parse(job.data);
      const rows = await db.execution.findMany({
        where: {
          collectionRunId: id,
          status: "QUEUED",
          availableAt: { lte: new Date() },
        },
        take: 100,
        select: { id: true },
      });
      for (const row of rows) {
        const existing = await queues.execution.getJob(row.id);
        if (existing && (await existing.getState()) === "failed")
          await existing.retry();
        else
          await queues.execution.add(
            "execute",
            { id: row.id },
            { jobId: row.id },
          );
      }
    },
    { ...options, concurrency: 2 },
  );
  const maintenance = new Worker(
    "maintenance",
    async () => {
      await processor.recoverExpired();
      await reconcileRuns(db, queues);
    },
    { ...options, concurrency: 1 },
  );
  for (const worker of [execution, collection, maintenance])
    worker.on("error", () =>
      console.error(
        "Worker infrastructure unavailable; durable state will be reconciled.",
      ),
    );
  return [execution, collection, maintenance];
}
