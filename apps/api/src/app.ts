import express, { type Express, type Request, type Response } from "express";
import { authRouter, authErrorHandler } from "./auth/router.js";
import type { AuthService } from "./auth/service.js";
import type { AuthConfig } from "./auth/config.js";
import type { GitHubProvider } from "./auth/github.js";
import {
  workspaceRouter,
  type WorkspaceDependencies,
} from "./workspaces/router.js";

export interface HealthResponse {
  service: "api";
  status: "ok";
  version: string;
  timestamp: string;
}

export function createApp(
  version: string,
  auth?: {
    service: AuthService;
    config: AuthConfig;
    provider?: GitHubProvider;
    workspace?: WorkspaceDependencies;
  },
): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  const health = (_request: Request, response: Response): void => {
    const payload: HealthResponse = {
      service: "api",
      status: "ok",
      version,
      timestamp: new Date().toISOString(),
    };
    response.status(200).json(payload);
  };

  app.get("/health/live", health);
  app.get("/health/ready", health);
  app.get("/api/v1/health", health);

  if (auth)
    app.use(
      "/api/v1/auth",
      authRouter(auth.service, auth.config, auth.provider),
    );
  if (auth?.workspace)
    app.use(
      "/api/v1",
      workspaceRouter(auth.service, auth.config, auth.workspace),
    );
  app.use(authErrorHandler);

  return app;
}
