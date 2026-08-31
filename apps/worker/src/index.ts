import { createHealthServer } from "./health-server.js";
import { env } from "./config/env.js";

const server = createHealthServer(env.APP_VERSION).listen(
  env.WORKER_PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Monitor-X worker health server listening on port ${env.WORKER_PORT}`,
    );
  },
);

function shutdown(signal: string): void {
  console.log(`Monitor-X worker received ${signal}; shutting down`);
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
