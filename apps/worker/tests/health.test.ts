import { describe, expect, it } from "vitest";

import { workerHealthPayload } from "../src/health-server.js";

describe("worker foundation health payload", () => {
  it("identifies the worker without exposing configuration", () => {
    expect(workerHealthPayload("test-version")).toMatchObject({
      service: "worker",
      status: "ok",
      version: "test-version",
    });
  });
});
