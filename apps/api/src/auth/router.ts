import { randomUUID } from "node:crypto";
import {
  Router,
  type Request,
  type Response,
  type CookieOptions,
  type NextFunction,
} from "express";
import { z } from "zod";
import { WorkspaceError } from "@monitorx/db";
import { Prisma } from "@prisma/client";
import {
  registerSchema,
  loginSchema,
  emailRequestSchema,
  verifyEmailSchema,
  resetPasswordSchema,
  authTokenSchema,
} from "@monitorx/contracts";
import { equalTokens, newToken, tokenHash } from "@monitorx/security";
import type { AuthService, SessionResult } from "./service.js";
import { ACCESS_MS, cookieNames, type AuthConfig } from "./config.js";
import { AuthError, denied } from "./errors.js";
import { rateLimit } from "./rate-limit.js";
import { audit } from "./audit.js";
import { createGitHubProvider, type GitHubProvider } from "./github.js";

const cookieOptions: CookieOptions = {
  secure: true,
  httpOnly: true,
  sameSite: "lax",
  path: "/",
};
export function cookie(req: Request, name: string): string {
  const parts = (req.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (parts.length !== 1) return "";
  const value = parts[0]?.slice(name.length + 1) ?? "";
  return authTokenSchema.safeParse(value).success ? value : "";
}
function setSession(res: Response, session: SessionResult): void {
  const remaining = Math.max(0, session.expiresAt.getTime() - Date.now());
  res.cookie(cookieNames.access, session.access, {
    ...cookieOptions,
    maxAge: Math.min(ACCESS_MS, remaining),
  });
  res.cookie(cookieNames.refresh, session.refresh, {
    ...cookieOptions,
    maxAge: remaining,
  });
}
function clearSession(res: Response): void {
  res.clearCookie(cookieNames.access, cookieOptions);
  res.clearCookie(cookieNames.refresh, cookieOptions);
}
export const requestId = (res: Response): string =>
  String(res.locals["requestId"]);

export function authRouter(
  service: AuthService,
  config: AuthConfig,
  provider: GitHubProvider = createGitHubProvider(config),
): Router {
  const router = Router();
  router.use((req, res, next) => {
    res.locals["requestId"] = randomUUID();
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId(res),
    });
    res.vary("Origin");
    if (req.headers.origin === config.APP_BASE_URL) {
      res.set({
        "Access-Control-Allow-Origin": config.APP_BASE_URL,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      });
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(req.headers.origin === config.APP_BASE_URL ? 204 : 403);
      return;
    }
    next();
  });
  router.use(async (req, res, next) => {
    // Express trust proxy remains false: forwarded headers cannot bypass these counters.
    await rateLimit(
      service.db,
      `auth:ip:${req.ip ?? "unknown"}`,
      120,
      requestId(res),
    );
    if (req.method !== "GET" && req.method !== "HEAD") {
      const csrf = cookie(req, cookieNames.csrf);
      const header = req.get("x-csrf-token") ?? "";
      if (
        req.headers.origin !== config.APP_BASE_URL ||
        !csrf ||
        !authTokenSchema.safeParse(header).success ||
        !equalTokens(csrf, header)
      ) {
        await audit(service.db, "csrf_rejected", requestId(res));
        throw new AuthError(
          403,
          "CSRF_REJECTED",
          "Request could not be verified.",
        );
      }
      if (!req.is("application/json"))
        throw new AuthError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Use application/json.",
        );
    }
    next();
  });
  router.get("/csrf", (req, res) => {
    const token = cookie(req, cookieNames.csrf) || newToken();
    res.cookie(cookieNames.csrf, token, {
      ...cookieOptions,
      maxAge: 24 * 60 * 60_000,
    });
    res.json({ csrfToken: token });
  });
  router.get("/config", (_req, res) => {
    res.json({ githubEnabled: config.GITHUB_OAUTH_ENABLED });
  });
  const emailLimit = async (
    email: string,
    route: string,
    req: Request,
    res: Response,
  ): Promise<void> => {
    await rateLimit(
      service.db,
      `auth:${route}:ip:${req.ip ?? "unknown"}`,
      route === "login" ? 30 : 10,
      requestId(res),
    );
    await rateLimit(
      service.db,
      `auth:${route}:email:${email}`,
      route === "login" ? 20 : 5,
      requestId(res),
    );
  };
  const accepted = (res: Response): void => {
    res
      .status(202)
      .json({ message: "If the account is eligible, an email will be sent." });
  };
  router.post("/register", async (req, res) => {
    const input = registerSchema.parse(req.body);
    await emailLimit(input.email, "register", req, res);
    await service.register(input, requestId(res));
    accepted(res);
  });
  router.post("/login", async (req, res) => {
    const input = loginSchema.parse(req.body);
    await emailLimit(input.email, "login", req, res);
    const session = await service.login(
      input.email,
      input.password,
      requestId(res),
    );
    setSession(res, session);
    res.json({ user: session.user });
  });
  router.post("/refresh", async (req, res) => {
    z.object({}).strict().parse(req.body);
    try {
      const session = await service.refresh(
        cookie(req, cookieNames.refresh),
        requestId(res),
      );
      setSession(res, session);
      res.json({ user: session.user });
    } catch (error) {
      if (error instanceof AuthError) clearSession(res);
      throw error;
    }
  });
  router.post("/logout", async (req, res) => {
    z.object({}).strict().parse(req.body);
    await service.logout(
      cookie(req, cookieNames.access),
      cookie(req, cookieNames.refresh),
      requestId(res),
    );
    clearSession(res);
    res.status(204).end();
  });
  router.get("/me", async (req, res) => {
    res.json({
      user: await service.authenticate(cookie(req, cookieNames.access)),
    });
  });
  for (const [path, purpose] of [
    ["/resend-verification", "VERIFY_EMAIL"],
    ["/forgot-password", "RESET_PASSWORD"],
  ] as const) {
    router.post(path, async (req, res) => {
      const input = emailRequestSchema.parse(req.body);
      await emailLimit(input.email, path, req, res);
      await service.requestEmail(input.email, purpose, requestId(res));
      accepted(res);
    });
  }
  router.post("/verify-email", async (req, res) => {
    const input = verifyEmailSchema.parse(req.body);
    await service.consumeEmail(input.token, "VERIFY_EMAIL", requestId(res));
    res.json({ message: "Email verified. You can now sign in." });
  });
  router.post("/reset-password", async (req, res) => {
    const input = resetPasswordSchema.parse(req.body);
    await rateLimit(
      service.db,
      `auth:reset:ip:${req.ip ?? "unknown"}`,
      10,
      requestId(res),
    );
    await service.consumeEmail(
      input.token,
      "RESET_PASSWORD",
      requestId(res),
      input.password,
    );
    clearSession(res);
    res.json({ message: "Password changed. Sign in again." });
  });
  router.get("/github", async (_req, res) => {
    if (!config.GITHUB_OAUTH_ENABLED)
      throw new AuthError(404, "NOT_FOUND", "Not found.");
    const state = newToken();
    const verifier = newToken();
    await service.db.oAuthAttempt.create({
      data: {
        stateHash: tokenHash(state),
        verifierHash: tokenHash(verifier),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    res.cookie(cookieNames.oauth, state, {
      ...cookieOptions,
      maxAge: 10 * 60_000,
    });
    res.cookie(cookieNames.verifier, verifier, {
      ...cookieOptions,
      maxAge: 10 * 60_000,
    });
    await audit(service.db, "oauth_started", requestId(res));
    res.redirect(provider.authorize(state, verifier));
  });
  router.get("/github/callback", async (req, res) => {
    if (!config.GITHUB_OAUTH_ENABLED)
      throw new AuthError(404, "NOT_FOUND", "Not found.");
    const query = z
      .object({ state: authTokenSchema, code: z.string().min(1).max(512) })
      .safeParse(req.query);
    const state = cookie(req, cookieNames.oauth);
    const verifier = cookie(req, cookieNames.verifier);
    res.clearCookie(cookieNames.oauth, cookieOptions);
    res.clearCookie(cookieNames.verifier, cookieOptions);
    try {
      if (
        !query.success ||
        !state ||
        !verifier ||
        !equalTokens(query.data.state, state)
      )
        throw denied();
      const consumed = await service.db.oAuthAttempt.updateMany({
        where: {
          stateHash: tokenHash(state),
          verifierHash: tokenHash(verifier),
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) throw denied();
      const profile = await provider.exchange(query.data.code, verifier);
      const session = await service.githubLogin(profile, requestId(res));
      setSession(res, session);
      res.redirect(config.APP_BASE_URL);
    } catch {
      await audit(service.db, "oauth_failed", requestId(res));
      throw denied();
    }
  });
  router.use(() => {
    throw new AuthError(404, "NOT_FOUND", "Not found.");
  });
  return router;
}

export function authErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  const id =
    typeof res.locals["requestId"] === "string"
      ? String(res.locals["requestId"])
      : randomUUID();
  const validation =
    error instanceof z.ZodError ||
    (error instanceof SyntaxError && "body" in error);
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P2002", "P2003"].includes(error.code)
  )
    error = new WorkspaceError(
      409,
      "CONFLICT",
      "The requested change conflicts with existing data.",
    );
  const known =
    error instanceof AuthError || error instanceof WorkspaceError
      ? error
      : null;
  const oversized =
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large";
  const status = known
    ? known.status
    : oversized
      ? 413
      : validation
        ? 400
        : 503;
  if (status === 429) res.set("Retry-After", "900");
  // No raw errors or Zod inputs: they can contain credentials.
  res
    .set("Cache-Control", "no-store")
    .status(status)
    .json({
      error: {
        code: known
          ? known.code
          : oversized
            ? "PAYLOAD_TOO_LARGE"
            : validation
              ? "VALIDATION_ERROR"
              : "SERVICE_UNAVAILABLE",
        message: known
          ? known.message
          : oversized
            ? "Request too large."
            : validation
              ? "Invalid request."
              : "Service temporarily unavailable.",
        requestId: id,
      },
    });
}
