import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  apiTestCreateSchema,
  apiTestUpdateSchema,
  previewTemplate,
  templateReferences,
  definitionErrors,
  MASK,
} from "../../packages/contracts/src/request-definition.js";
import { permits } from "../../packages/db/src/services/tenant-access.js";

const base = {
  projectId: randomUUID(),
  collectionId: randomUUID(),
  name: "Health",
  method: "GET",
  urlTemplate: "{{BASE_URL}}/health",
};
describe("request configuration contracts", () => {
  it("allows nested JSON and bounds substitution before allocating an oversized preview", () => {
    expect(
      apiTestCreateSchema.safeParse({
        ...base,
        method: "POST",
        bodyMode: "JSON",
        bodyTemplate: '{"outer":{"inner":"{{VALUE}}"}}',
      }).success,
    ).toBe(true);
    expect(() =>
      previewTemplate("{{A}}".repeat(100), { A: "x".repeat(10000) }, []),
    ).toThrow("Expanded preview exceeds its size limit.");
  });
  it("uses disabled defaults, 10s timeout and no redirects; Editor can edit but cannot administer", () => {
    const result = apiTestCreateSchema.parse(base);
    expect(result.enabled).toBe(false);
    expect(result.timeoutMs).toBe(10000);
    expect(result.maxRedirects).toBe(0);
    expect(permits("EDITOR", "edit")).toBe(true);
    expect(permits("EDITOR", "manage")).toBe(false);
    expect(permits("VIEWER", "edit")).toBe(false);
  });
  it.each([
    { urlTemplate: "file:///etc/passwd" },
    { urlTemplate: "https://user:password@example.test" },
    { urlTemplate: "https://example.test/#fragment" },
    { urlTemplate: "{{base_url}}/health" },
    { urlTemplate: "{{ BASE_URL }}/health" },
    { method: "PURGE" },
    { method: "CONNECT", advancedMethod: true },
    { timeoutMs: 30001 },
    { followRedirects: true, maxRedirects: 0 },
    { maxRedirects: 4 },
    { enabled: true },
    { headerRows: [{ key: "Host", value: "example.test" }] },
    { headerRows: [{ key: "X-Test", value: "bad\r\nHeader: value" }] },
    {
      headerRows: [
        { key: "X-Test", value: "a" },
        { key: "x-test", value: "b" },
      ],
    },
    { headerRows: [{ key: "Authorization", value: "literal-credential" }] },
    { queryRows: [{ key: "api_key", value: "literal-credential" }] },
    { urlTemplate: "https://example.test?token=literal-credential" },
    { authConfig: { type: "BEARER", token: "literal-credential" } },
    { authConfig: { type: "NONE", password: "injected" } },
    { bodyMode: "JSON", bodyTemplate: "{}" },
    { method: "POST", bodyMode: "JSON", bodyTemplate: '{"broken":}' },
    { method: "POST", bodyMode: "RAW", bodyTemplate: "é".repeat(140000) },
    { assertions: [{ type: "javascript", expected: "return true" }] },
    { authConfig: { type: "CUSTOM_HEADER", name: "Host", value: "{{TOKEN}}" } },
    { tags: ["same", "same"] },
    { organizationId: randomUUID() },
  ])("rejects unsafe or inconsistent definitions %#", (patch) => {
    expect(apiTestCreateSchema.safeParse({ ...base, ...patch }).success).toBe(
      false,
    );
  });
  it.each(["NONE", "JSON", "RAW", "XML", "FORM_URLENCODED"] as const)(
    "accepts %s bodies with valid configuration",
    (bodyMode) => {
      expect(
        apiTestCreateSchema.safeParse({
          ...base,
          method: "POST",
          bodyMode,
          bodyTemplate:
            bodyMode === "JSON"
              ? '{"query":"{{QUERY}}"}'
              : bodyMode === "XML"
                ? "<root>{{VALUE}}</root>"
                : bodyMode === "RAW"
                  ? "{{VALUE}}"
                  : null,
          formRows:
            bodyMode === "FORM_URLENCODED"
              ? [{ key: "name", value: "{{NAME}}" }]
              : [],
        }).success,
      ).toBe(true);
    },
  );
  it("supports reference-only auth modes and bounded assertions without evaluating patterns", () => {
    for (const authConfig of [
      { type: "NONE" },
      { type: "BEARER", token: "{{TOKEN}}" },
      { type: "BASIC", username: "local", password: "{{PASSWORD}}" },
      { type: "API_KEY", in: "QUERY", name: "key", value: "{{KEY}}" },
      { type: "CUSTOM_HEADER", name: "X-Token", value: "{{TOKEN}}" },
    ])
      expect(
        apiTestCreateSchema.safeParse({ ...base, authConfig }).success,
      ).toBe(true);
    expect(
      apiTestCreateSchema.safeParse({
        ...base,
        method: "PURGE",
        advancedMethod: true,
        assertions: [
          { type: "status", expected: [200, 204] },
          { type: "latency", expected: 500, severity: "WARNING" },
          { type: "json_path", path: "$.id" },
          {
            type: "json_compare",
            path: "$.ok",
            operator: "equals",
            expected: true,
          },
          { type: "regex", pattern: "(a+)+$" },
          { type: "xpath", path: "/root", expected: "OK" },
        ],
      }).success,
    ).toBe(true);
  });
  it("requires optimistic revision and never permits moving a test to another project", () => {
    expect(apiTestUpdateSchema.safeParse({ name: "Changed" }).success).toBe(
      false,
    );
    expect(apiTestUpdateSchema.safeParse({ expectedRevision: 1 }).success).toBe(
      false,
    );
    expect(
      apiTestUpdateSchema.safeParse({
        expectedRevision: 1,
        projectId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      apiTestUpdateSchema.safeParse({ expectedRevision: 1, name: "Changed" })
        .success,
    ).toBe(true);
  });
  it("uses deterministic single-pass preview, masks secrets and safely reports errors", () => {
    expect(templateReferences("{{A}}/{{A}}/{{B}}")).toEqual(["A", "B"]);
    expect(
      previewTemplate("{{A}}/{{TOKEN}}/{{MISSING}}", { A: "{{TOKEN}}" }, [
        "TOKEN",
      ]),
    ).toBe(`{{TOKEN}}/${MASK}/{{MISSING}}`);
    const result = apiTestCreateSchema.safeParse({
      ...base,
      authConfig: { type: "literal-private-marker" },
      "private-field-marker": "value",
    });
    if (result.success) throw Error("Expected validation error");
    const message = definitionErrors(result.error);
    expect(
      message.includes("literal-private-marker") ||
        message.includes("private-field-marker"),
    ).toBe(false);
  });
});
