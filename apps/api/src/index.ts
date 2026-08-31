import { createApp } from "./app.js";
import { env } from "./config/env.js";

const app = createApp(env.APP_VERSION);
const server = app.listen(env.API_PORT, "0.0.0.0", () => {
  console.log(`Monitor-X API listening on port ${env.API_PORT}`);
});

function shutdown(signal: string): void {
  console.log(`Monitor-X API received ${signal}; shutting down`);
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
