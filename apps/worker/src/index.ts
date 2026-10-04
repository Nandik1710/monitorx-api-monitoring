import { createHealthServer } from "./health-server.js";
import { env } from "./config/env.js";
import { prisma } from "@monitorx/db";
import { configureTenantEncryption } from "@monitorx/security";
import { ExecutionProcessor } from "./execution-processor.js";
import { Scheduler } from "./scheduler.js";
import {
  createQueues,
  redisConnection,
  startQueueWorkers,
  reconcileRuns,
} from "./queues.js";

const connection = redisConnection(env.REDIS_URL);
const queues = createQueues(connection);
for (const queue of Object.values(queues))
  queue.on("error", () => console.error("Queue connection unavailable."));
const processor = new ExecutionProcessor(
  prisma,
  configureTenantEncryption(process.env),
);
const scheduler = new Scheduler(prisma);
const workers = startQueueWorkers(
  prisma,
  queues,
  processor,
  connection,
  "monitorx",
  env.WORKER_CONCURRENCY,
);
let reconciling = false;
const reconcile = async () => {
  if (reconciling) return;
  reconciling = true;
  try {
    await scheduler.reconcile();
    await reconcileRuns(prisma, queues);
    await queues.maintenance.add(
      "reconcile",
      {},
      { jobId: "maintenance-tick" },
    );
  } catch {
    scheduler.metrics.errors++;
    console.error(
      "Reconciliation temporarily unavailable; durable runs retained.",
    );
  } finally {
    reconciling = false;
  }
};
const timer = setInterval(() => void reconcile(), 2000);
void reconcile();

const server = createHealthServer(
  env.APP_VERSION,
  () => scheduler.metrics,
).listen(env.WORKER_PORT, "0.0.0.0", () => {
  console.log(
    `Monitor-X worker health server listening on port ${env.WORKER_PORT}`,
  );
});

function shutdown(signal: string): void {
  console.log(`Monitor-X worker received ${signal}; shutting down`);
  clearInterval(timer);
  server.close(() => {
    void Promise.all(workers.map((worker) => worker.close()))
      .then(() =>
        Promise.all(Object.values(queues).map((queue) => queue.close())),
      )
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0));
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
