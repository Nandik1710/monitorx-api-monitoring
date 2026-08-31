import express, { type Express, type Request, type Response } from "express";

export interface HealthResponse {
  service: "api";
  status: "ok";
  version: string;
  timestamp: string;
}

export function createApp(version: string): Express {
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

  return app;
}
