import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

describe("API foundation health endpoints", () => {
  it("returns a stable live health payload", async () => {
    const response = await request(createApp("test-version")).get(
      "/health/live",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      service: "api",
      status: "ok",
      version: "test-version",
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
  });
});
