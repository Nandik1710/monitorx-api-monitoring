import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createMailer } from "../../apps/api/src/auth/mail.js";
import { authConfigSchema } from "../../apps/api/src/auth/config.js";
import { newToken } from "../../packages/security/src/auth.js";

it.skipIf(process.env.RUN_INTEGRATION !== "true")(
  "delivers verification, reset and invitation links through real Mailpit SMTP",
  async () => {
    const config = authConfigSchema.parse({});
    const mailer = createMailer(config);
    const recipient = `auth-test-${randomUUID()}@example.test`;
    const token = newToken();
    const ids: string[] = [];
    try {
      const organizationId = randomUUID();
      for (const purpose of [
        "VERIFY_EMAIL",
        "RESET_PASSWORD",
        "INVITATION",
      ] as const) {
        if (purpose === "INVITATION")
          await mailer.sendInvitation(recipient, organizationId, token);
        else await mailer.send(recipient, purpose, token);
        const response = await fetch(
          `http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`,
          { signal: AbortSignal.timeout(5000) },
        );
        expect(response.ok).toBe(true);
        const result = (await response.json()) as {
          messages: Array<{ ID: string }>;
        };
        const message = result.messages.find((item) => !ids.includes(item.ID));
        expect(!!message).toBe(true);
        if (!message) throw new Error("Expected a new Mailpit fixture message");
        ids.push(message.ID);
        const details = await fetch(
          `http://localhost:8025/api/v1/message/${message.ID}`,
          { signal: AbortSignal.timeout(5000) },
        );
        const content = (await details.json()) as { Text: string };
        const fragment =
          purpose === "INVITATION"
            ? `invitation=${organizationId}.${token}`
            : `${purpose === "VERIFY_EMAIL" ? "verify-email" : "reset-password"}=${token}`;
        expect(
          content.Text.includes(`${config.APP_BASE_URL}/#${fragment}`),
        ).toBe(true);
      }
    } finally {
      if (ids.length) {
        const response = await fetch("http://localhost:8025/api/v1/messages", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ IDs: ids }),
          signal: AbortSignal.timeout(5000),
        });
        expect(response.ok).toBe(true);
      }
    }
  },
  30000,
);
