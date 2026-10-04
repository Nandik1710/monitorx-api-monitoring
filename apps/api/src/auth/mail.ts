import nodemailer from "nodemailer";
import type { AuthConfig } from "./config.js";

export interface AuthMailer {
  send(
    to: string,
    purpose: "VERIFY_EMAIL" | "RESET_PASSWORD",
    token: string,
  ): Promise<void>;
}
export function createMailer(config: AuthConfig): AuthMailer & {
  sendInvitation(
    to: string,
    organizationId: string,
    token: string,
  ): Promise<void>;
} {
  const smtp = new URL(config.MAILPIT_SMTP_URL);
  const transport = nodemailer.createTransport(
    {
      host: smtp.hostname,
      port: Number(smtp.port || (smtp.protocol === "smtps:" ? 465 : 587)),
      secure: smtp.protocol === "smtps:",
      requireTLS: !["localhost", "127.0.0.1"].includes(smtp.hostname),
      ...(smtp.username
        ? {
            auth: {
              user: decodeURIComponent(smtp.username),
              pass: decodeURIComponent(smtp.password),
            },
          }
        : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    },
    {
      from: config.AUTH_MAIL_FROM,
    },
  );
  return {
    async sendInvitation(to, organizationId, token) {
      const link = `${config.APP_BASE_URL}/#invitation=${organizationId}.${token}`;
      await transport.sendMail({
        to,
        subject: "Monitor-X: Workspace invitation",
        text: `Sign in with this email address, then accept your workspace invitation: ${link}\n\nThis link expires in seven days. Ignore it if unexpected.`,
      });
    },
    async send(to, purpose, token) {
      const action =
        purpose === "VERIFY_EMAIL" ? "verify-email" : "reset-password";
      const label =
        purpose === "VERIFY_EMAIL"
          ? "Verify your email"
          : "Reset your password";
      // Fragments stay in the browser and are not sent to web-server access logs.
      const link = `${config.APP_BASE_URL}/#${action}=${encodeURIComponent(token)}`;
      await transport.sendMail({
        to,
        subject: `Monitor-X: ${label}`,
        text: `${label}: ${link}\n\nIf you did not request this, ignore this message.`,
      });
    },
  };
}
