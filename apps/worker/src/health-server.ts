import { createServer, type Server } from "node:http";

export interface WorkerHealthResponse {
  service: "worker";
  status: "ok";
  version: string;
  timestamp: string;
}

export function workerHealthPayload(version: string): WorkerHealthResponse {
  return {
    service: "worker",
    status: "ok",
    version,
    timestamp: new Date().toISOString(),
  };
}

export function createHealthServer(version: string): Server {
  return createServer((request, response) => {
    if (request.url !== "/health/live" && request.url !== "/health/ready") {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(workerHealthPayload(version)));
  });
}
