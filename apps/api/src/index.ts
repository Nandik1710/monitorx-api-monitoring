import { createApp } from "./app.js";
import { env, authConfig } from "./config/env.js";
import { prisma } from "@monitorx/db";
import { AuthService } from "./auth/service.js";
import { createMailer } from "./auth/mail.js";
import { configureTenantEncryption } from "./workspaces/config.js";
import { attachLiveEvents } from "./live-events.js";

const mailer = createMailer(authConfig);
const auth = new AuthService(prisma, mailer);

const app = createApp(env.APP_VERSION, {
  service: auth,
  config: authConfig,
  workspace: { encryption: configureTenantEncryption(process.env), mailer },
});
const server = app.listen(env.API_PORT, "0.0.0.0", () => {
  console.log(`Monitor-X API listening on port ${env.API_PORT}`);
});
const events = attachLiveEvents(server, auth, authConfig);

function shutdown(signal: string): void {
  for (const client of events.clients)
    client.close(1001, "Server shutting down");
  events.close();
  console.log(`Monitor-X API received ${signal}; shutting down`);
  server.close(() => {
    void prisma.$disconnect().then(() => process.exit(0));
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
