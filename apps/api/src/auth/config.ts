import { z } from "zod";

const origin = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.origin === value &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" && url.hostname === "localhost"))
      );
    } catch {
      return false;
    }
  }, "Use an HTTPS origin (HTTP localhost is permitted for development)");

export const authConfigSchema = z
  .object({
    APP_BASE_URL: origin.default("http://localhost:5173"),
    API_BASE_URL: origin.default("http://localhost:4000"),
    MAILPIT_SMTP_URL: z.string().url().default("smtp://localhost:1025"),
    AUTH_MAIL_FROM: z.string().email().default("no-reply@monitorx.local"),
    GITHUB_OAUTH_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .superRefine((config, ctx) => {
    if (
      config.GITHUB_OAUTH_ENABLED &&
      (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "GitHub OAuth requires a client ID and secret",
      });
    }
    if (!/^smtps?:\/\//.test(config.MAILPIT_SMTP_URL)) {
      ctx.addIssue({ code: "custom", message: "Invalid SMTP protocol" });
    }
  });
export type AuthConfig = z.infer<typeof authConfigSchema>;

export const ACCESS_MS = 15 * 60_000;
export const SESSION_MS = 7 * 24 * 60 * 60_000;
export const cookieNames = {
  access: "__Host-mx_access",
  refresh: "__Host-mx_refresh",
  csrf: "__Host-mx_csrf",
  oauth: "__Host-mx_oauth",
  verifier: "__Host-mx_pkce",
} as const;
