import { describe, expect, it } from "vitest";

import {
  apiTestCreateSchema,
  createErrorEnvelope,
  environmentCreateSchema,
  errorEnvelopeSchema,
  organizationCreateSchema,
} from "../../packages/contracts/src/index.js";

describe("shared API contracts", () => {
  it("applies safe defaults to environment and test inputs", () => {
    const environment = environmentCreateSchema.parse({
      projectId: "00000000-0000-4000-8000-000000000003",
      name: "Local",
      slug: "local",
    });
    const apiTest = apiTestCreateSchema.parse({
      projectId: "00000000-0000-4000-8000-000000000003",
      collectionId: "00000000-0000-4000-8000-000000000004",
      name: "Health",
      method: "GET",
      urlTemplate: "http://localhost:4000/health/live",
    });

    expect(environment.variables).toEqual({});
    expect(apiTest.timeoutMs).toBe(10_000);
    expect(apiTest.followRedirects).toBe(false);
  });

  it("rejects unknown organization fields", () => {
    expect(() =>
      organizationCreateSchema.parse({
        name: "Example",
        slug: "example",
        secret: "not-allowed",
      }),
    ).toThrow();
  });

  it("creates and validates a typed error envelope", () => {
    const envelope = createErrorEnvelope(
      "VALIDATION_ERROR",
      "Input is invalid",
      "request-123",
      {
        field: "name",
      },
    );

    expect(errorEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });
});
