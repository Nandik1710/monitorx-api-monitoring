import { describe, expect, it, vi } from "vitest";
import { apiTestCreateSchema } from "../../packages/contracts/src/request-definition.js";
import {
  executeTest,
  isPublicAddress,
  normalizeRequest,
  evaluateAssertions,
} from "../../packages/test-engine/src/index.js";
const definition = (change = {}) =>
  apiTestCreateSchema.parse({
    projectId: "00000000-0000-4000-8000-000000000001",
    collectionId: "00000000-0000-4000-8000-000000000002",
    name: "Fixture",
    method: "GET",
    urlTemplate: "https://example.test/health",
    ...change,
  });
const resolver = async () => [{ address: "93.184.216.34", family: 4 }];
const response = {
  status: 200,
  headers: { "content-type": "application/json" },
  body: Buffer.from('{"ok":true,"items":[1,2]}'),
};
describe("safe worker engine", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "240.0.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "ff00::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "2002:7f00:1::",
    "64:ff9b::7f00:1",
    "3fff::1",
  ])("rejects non-public %s", (address) =>
    expect(isPublicAddress(address)).toBe(false),
  );
  it("permits global IPv4 and IPv6", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("normalizes JSON values without structural injection and encodes form/query values", () => {
    const request = normalizeRequest({
      definition: definition({
        method: "POST",
        bodyMode: "JSON",
        bodyTemplate: '{"value":"{{VALUE}}"}',
        queryRows: [{ key: "q", value: "{{VALUE}}" }],
      }),
      variables: { VALUE: 'a"b&c' },
      secrets: {},
    });
    expect(JSON.parse(request.body!)).toEqual({ value: 'a"b&c' });
    expect(request.url.searchParams.get("q")).toBe('a"b&c');
    expect(
      normalizeRequest({
        definition: definition({
          method: "POST",
          bodyMode: "FORM_URLENCODED",
          formRows: [{ key: "q", value: "a&b" }],
        }),
        variables: {},
        secrets: {},
      }).body,
    ).toBe("q=a%26b");
  });
  it("fails missing variables and expanded header injection without contacting a target", async () => {
    const transport = vi.fn();
    for (const input of [
      {
        definition: definition({ urlTemplate: "{{MISSING}}/x" }),
        variables: {},
        secrets: {},
      },
      {
        definition: definition({
          headerRows: [{ key: "X-Test", value: "{{BAD}}" }],
        }),
        variables: { BAD: "a\r\nb: c" },
        secrets: {},
      },
    ])
      expect(
        (await executeTest(input, { transport, resolver })).errorClass,
      ).toBe("configuration_error");
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects mixed DNS answers and does not re-resolve inside transport", async () => {
    const transport = vi.fn(async () => response);
    const input = { definition: definition(), variables: {}, secrets: {} };
    expect(
      (
        await executeTest(input, {
          resolver: async () => [
            ...(await resolver()),
            { address: "10.0.0.1", family: 4 },
          ],
          transport,
        })
      ).errorClass,
    ).toBe("configuration_error");
    expect(transport).not.toHaveBeenCalled();
    const dns = vi.fn(resolver);
    expect(
      (await executeTest(input, { resolver: dns, transport })).status,
    ).toBe("PASSED");
    expect(dns).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[1]).toEqual({
      address: "93.184.216.34",
      family: 4,
    });
  });
  it("revalidates redirects including DNS rebinding and enforces hop limits", async () => {
    const transport = vi.fn(async () => ({
      ...response,
      status: 302,
      headers: { location: "/again" },
    }));
    let calls = 0;
    const dns = async () =>
      ++calls === 1 ? resolver() : [{ address: "127.0.0.1", family: 4 }];
    const input = {
      definition: definition({ followRedirects: true, maxRedirects: 1 }),
      variables: {},
      secrets: {},
    };
    expect(
      (await executeTest(input, { resolver: dns, transport })).errorClass,
    ).toBe("configuration_error");
    expect(transport).toHaveBeenCalledOnce();
    expect((await executeTest(input, { resolver, transport })).errorClass).toBe(
      "response_error",
    );
  });
  it("evaluates independently and distinguishes warnings from required failures", async () => {
    const assertions = [
      { type: "status", expected: 200 },
      { type: "latency", expected: 10000 },
      {
        type: "header",
        name: "content-type",
        operator: "contains",
        expected: "json",
      },
      { type: "json_path", path: "$.items[0]" },
      {
        type: "json_compare",
        path: "$.ok",
        operator: "equals",
        expected: true,
      },
      { type: "text", operator: "contains", expected: "ok" },
      { type: "regex", pattern: "ok", flags: "i" },
    ];
    const input = {
      definition: definition({ assertions }),
      variables: {},
      secrets: {},
    };
    const result = await executeTest(input, {
      resolver,
      transport: async () => response,
    });
    expect(result.assertions.every((a) => a.passed)).toBe(true);
    const warning = await executeTest(
      {
        ...input,
        definition: definition({
          assertions: [{ type: "status", expected: 201, severity: "WARNING" }],
        }),
      },
      { resolver, transport: async () => response },
    );
    expect(warning.healthState).toBe("DEGRADED");
    expect(
      (
        await executeTest(
          {
            ...input,
            definition: definition({
              assertions: [{ type: "status", expected: 201 }],
            }),
          },
          { resolver, transport: async () => response },
        )
      ).status,
    ).toBe("FAILED");
  });
  it("supports SOAP child XPath and rejects entities and regex backreferences", () => {
    const assertions = definition({
      assertions: [
        { type: "xpath", path: "/Envelope/Body/Status", expected: "OK" },
        { type: "regex", pattern: "(a)\\1" },
      ],
    }).assertions;
    const run = (body: string) =>
      evaluateAssertions(assertions, {
        body,
        headers: {},
        status: 200,
        latencyMs: 1,
      });
    expect(
      run(
        "<s:Envelope xmlns:s='soap'><s:Body><Status>OK</Status></s:Body></s:Envelope>",
      ).map((a) => a.passed),
    ).toEqual([true, false]);
    expect(
      run('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///secret">]><x>&a;</x>')[0]
        ?.passed,
    ).toBe(false);
  });
  it("redacts secrets, auth and unexpected sensitive JSON keys in serialized results", async () => {
    const fake = "fake-only-engine-marker";
    const result = await executeTest(
      {
        definition: definition({
          authConfig: { type: "BEARER", token: "{{TOKEN}}" },
          assertions: [
            {
              type: "header",
              name: "set-cookie",
              operator: "exists",
              expected: "",
            },
            {
              type: "json_compare",
              path: "$.password",
              operator: "equals",
              expected: "unrelated",
            },
          ],
        }),
        variables: {},
        secrets: { TOKEN: fake },
      },
      {
        resolver,
        transport: async () => ({
          ...response,
          headers: { "set-cookie": "unexpected-cookie-marker" },
          body: Buffer.from(
            JSON.stringify({
              echo: fake,
              password: "unexpected-password-marker",
            }),
          ),
        }),
      },
    );
    expect(JSON.stringify(result)).not.toContain(fake);
    expect(JSON.stringify(result)).not.toContain("unexpected-cookie-marker");
    expect(JSON.stringify(result)).not.toContain("unexpected-password-marker");
  });
  it("bounds DNS time, classifies TLS errors and honors cancellation", async () => {
    const input = {
      definition: definition({ timeoutMs: 100 }),
      variables: {},
      secrets: {},
    };
    expect(
      (await executeTest(input, { resolver: () => new Promise(() => {}) }))
        .errorClass,
    ).toBe("timeout");
    expect(
      (
        await executeTest(input, {
          resolver,
          transport: async () => {
            throw Object.assign(new Error("never expose"), {
              code: "DEPTH_ZERO_SELF_SIGNED_CERT",
            });
          },
        })
      ).errorClass,
    ).toBe("tls_error");
    expect(
      (await executeTest(input, { signal: AbortSignal.abort() })).status,
    ).toBe("CANCELLED");
  });
});
