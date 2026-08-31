import { describe, expect, it } from "vitest";

import { serviceHealthSchema } from "../../packages/contracts/src/index.js";

describe("shared foundation contracts", () => {
  it("validates a service health response", () => {
    const result = serviceHealthSchema.parse({
      service: "api",
      status: "ok",
      version: "test-version",
      timestamp: "2026-08-31T00:00:00.000Z",
    });

    expect(result.service).toBe("api");
  });

  it("rejects an invalid service status", () => {
    expect(() =>
      serviceHealthSchema.parse({
        service: "api",
        status: "healthy",
        version: "test-version",
        timestamp: "2026-08-31T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
