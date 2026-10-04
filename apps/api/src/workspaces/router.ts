import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  OrganizationService,
  ProjectService,
  EnvironmentService,
  InvitationService,
  TenantAccess,
  type InvitationMailer,
} from "@monitorx/db";
import { equalTokens, type TenantEncryption } from "@monitorx/security";
import {
  authTokenSchema,
  resourceIdSchema,
  emptyInputSchema,
  type Actor,
  type TenantContext,
} from "@monitorx/contracts";
import type { AuthService } from "../auth/service.js";
import type { AuthConfig } from "../auth/config.js";
import { cookieNames } from "../auth/config.js";
import { cookie, requestId } from "../auth/router.js";
import { AuthError } from "../auth/errors.js";
import { rateLimit } from "../auth/rate-limit.js";
import { testRouter } from "./test-router.js";
import { runRouter } from "./run-router.js";
import { scheduleRouter } from "./schedule-router.js";
import { reliabilityRouter } from "./reliability-router.js";

export interface WorkspaceDependencies {
  encryption: TenantEncryption;
  mailer: InvitationMailer;
}
export function workspaceRouter(
  auth: AuthService,
  config: AuthConfig,
  dependencies: WorkspaceDependencies,
): Router {
  const router = Router();
  const access = new TenantAccess(auth.db);
  const organizations = new OrganizationService(access);
  const projects = new ProjectService(access);
  const environments = new EnvironmentService(access, dependencies.encryption);
  const invitations = new InvitationService(access, dependencies.mailer);
  router.use((req, res, next) => {
    res.locals["requestId"] = randomUUID();
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId(res),
    });
    res.vary("Origin");
    if (req.headers.origin === config.APP_BASE_URL)
      res.set({
        "Access-Control-Allow-Origin": config.APP_BASE_URL,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers":
          "Content-Type, X-CSRF-Token, X-Organization-Id",
        "Access-Control-Allow-Methods":
          "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      });
    if (req.method === "OPTIONS") {
      res.sendStatus(req.headers.origin === config.APP_BASE_URL ? 204 : 403);
      return;
    }
    next();
  });
  router.use(async (req, res, next) => {
    await rateLimit(
      auth.db,
      `workspace:ip:${req.ip ?? "unknown"}`,
      600,
      requestId(res),
    );
    const user = await auth.authenticate(cookie(req, cookieNames.access));
    res.locals["actor"] = {
      userId: user.id,
      requestId: requestId(res),
    } satisfies Actor;
    await rateLimit(auth.db, `workspace:user:${user.id}`, 300, requestId(res));
    if (!["GET", "HEAD"].includes(req.method)) {
      const csrf = cookie(req, cookieNames.csrf);
      const header = req.get("x-csrf-token") ?? "";
      if (
        req.headers.origin !== config.APP_BASE_URL ||
        !csrf ||
        !authTokenSchema.safeParse(header).success ||
        !equalTokens(csrf, header)
      )
        throw new AuthError(
          403,
          "CSRF_REJECTED",
          "Request could not be verified.",
        );
      if (!req.is("application/json"))
        throw new AuthError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Use application/json.",
        );
    }
    next();
  });
  const actor = (res: Response): Actor => res.locals["actor"] as Actor;
  const context = (
    req: Request,
    res: Response,
    fromPath = false,
  ): TenantContext => ({
    ...actor(res),
    organizationId: resourceIdSchema.parse(
      fromPath ? req.params["organizationId"] : req.get("x-organization-id"),
    ),
  });
  const id = (req: Request, key: string): string =>
    resourceIdSchema.parse(req.params[key]);
  router.get("/organizations", async (req, res) => {
    res.json({ items: await organizations.listForUser(actor(res), req.query) });
  });
  router.post("/organizations", async (req, res) => {
    res.status(201).json(await organizations.create(actor(res), req.body));
  });
  router.get("/organizations/:organizationId", async (req, res) => {
    res.json(await organizations.get(context(req, res, true)));
  });
  router.patch("/organizations/:organizationId", async (req, res) => {
    res.json(await organizations.update(context(req, res, true), req.body));
  });
  router.get("/organizations/:organizationId/members", async (req, res) => {
    res.json({
      items: await organizations.members(context(req, res, true), req.query),
    });
  });
  router.patch(
    "/organizations/:organizationId/members/:userId",
    async (req, res) => {
      res.json(
        await organizations.changeRole(
          context(req, res, true),
          id(req, "userId"),
          req.body,
        ),
      );
    },
  );
  router.delete(
    "/organizations/:organizationId/members/:userId",
    async (req, res) => {
      emptyInputSchema.parse(req.body);
      await organizations.removeMember(
        context(req, res, true),
        id(req, "userId"),
      );
      res.status(204).end();
    },
  );
  router.get("/organizations/:organizationId/invites", async (req, res) => {
    res.json({
      items: await invitations.list(context(req, res, true), req.query),
    });
  });
  router.post("/organizations/:organizationId/invites", async (req, res) => {
    await rateLimit(
      auth.db,
      `invitation:sender:${actor(res).userId}`,
      20,
      requestId(res),
    );
    res
      .status(201)
      .json(await invitations.create(context(req, res, true), req.body));
  });
  router.post(
    "/organizations/:organizationId/invites/accept",
    async (req, res) => {
      res.json(
        await invitations.accept(
          actor(res),
          id(req, "organizationId"),
          req.body,
        ),
      );
    },
  );
  router.delete(
    "/organizations/:organizationId/invites/:inviteId",
    async (req, res) => {
      emptyInputSchema.parse(req.body);
      await invitations.revoke(context(req, res, true), id(req, "inviteId"));
      res.status(204).end();
    },
  );
  router.get("/projects", async (req, res) => {
    res.json({ items: await projects.list(context(req, res), req.query) });
  });
  router.post("/projects", async (req, res) => {
    res.status(201).json(await projects.create(context(req, res), req.body));
  });
  router.get("/projects/:projectId", async (req, res) => {
    res.json(await projects.get(context(req, res), id(req, "projectId")));
  });
  router.patch("/projects/:projectId", async (req, res) => {
    res.json(
      await projects.update(context(req, res), id(req, "projectId"), req.body),
    );
  });
  router.delete("/projects/:projectId", async (req, res) => {
    emptyInputSchema.parse(req.body);
    await projects.remove(context(req, res), id(req, "projectId"));
    res.status(204).end();
  });
  router.get("/projects/:projectId/environments", async (req, res) => {
    res.json({
      items: await environments.list(
        context(req, res),
        id(req, "projectId"),
        req.query,
      ),
    });
  });
  router.post("/projects/:projectId/environments", async (req, res) => {
    res
      .status(201)
      .json(
        await environments.create(
          context(req, res),
          id(req, "projectId"),
          req.body,
        ),
      );
  });
  router.get("/environments/:environmentId", async (req, res) => {
    res.json(
      await environments.get(context(req, res), id(req, "environmentId")),
    );
  });
  router.patch("/environments/:environmentId", async (req, res) => {
    res.json(
      await environments.update(
        context(req, res),
        id(req, "environmentId"),
        req.body,
      ),
    );
  });
  router.delete("/environments/:environmentId", async (req, res) => {
    emptyInputSchema.parse(req.body);
    await environments.remove(context(req, res), id(req, "environmentId"));
    res.status(204).end();
  });
  router.get("/environments/:environmentId/secrets", async (req, res) => {
    res.json({
      items: await environments.secrets(
        context(req, res),
        id(req, "environmentId"),
        req.query,
      ),
    });
  });
  router.put("/environments/:environmentId/secrets/:key", async (req, res) => {
    res.json(
      await environments.writeSecret(
        context(req, res),
        id(req, "environmentId"),
        z.string().parse(req.params["key"]),
        req.body,
      ),
    );
  });
  router.delete(
    "/environments/:environmentId/secrets/:key",
    async (req, res) => {
      emptyInputSchema.parse(req.body);
      await environments.removeSecret(
        context(req, res),
        id(req, "environmentId"),
        z.string().parse(req.params["key"]),
      );
      res.status(204).end();
    },
  );
  router.post(
    "/environments/:environmentId/secrets/:key/rotate",
    async (req, res) => {
      emptyInputSchema.parse(req.body);
      res.json(
        await environments.rotateSecret(
          context(req, res),
          id(req, "environmentId"),
          z.string().parse(req.params["key"]),
        ),
      );
    },
  );
  router.use(testRouter(access, context));
  router.use(runRouter(access, context));
  router.use(scheduleRouter(access, context));
  router.use(reliabilityRouter(access, context));
  router.use(() => {
    throw new AuthError(404, "NOT_FOUND", "Resource not found.");
  });
  return router;
}
