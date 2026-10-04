import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createGitHubProvider } from "../../apps/api/src/auth/github.js";
import { authConfigSchema } from "../../apps/api/src/auth/config.js";

describe("GitHub provider boundary", () => {
  afterEach(() => vi.unstubAllGlobals());
  const provider = createGitHubProvider(
    authConfigSchema.parse({
      GITHUB_OAUTH_ENABLED: "true",
      GITHUB_CLIENT_ID: "fixture-client",
      GITHUB_CLIENT_SECRET: "fixture-not-a-real-secret",
    }),
  );
  it("requests PKCE, exact callback, and email scope", () => {
    const url = new URL(
      provider.authorize("fixture-state", "fixture-verifier"),
    );
    expect(url.origin).toBe("https://github.com");
    expect(
      url.searchParams.get("code_challenge") ===
        createHash("sha256").update("fixture-verifier").digest("base64url"),
    ).toBe(true);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:4000/api/v1/auth/github/callback",
    );
    expect(url.searchParams.get("scope")).toContain("user:email");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });
  it("uses immutable identity and a verified primary email, not the public profile email", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "fixture-token" }))
      .mockResolvedValueOnce(
        Response.json({
          id: 1234,
          login: "Fixture",
          email: "untrusted@example.test",
        }),
      )
      .mockResolvedValueOnce(
        Response.json([
          { email: "Verified@EXAMPLE.TEST", primary: true, verified: true },
        ]),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await provider.exchange("fixture-code", "fixture-verifier")).toEqual(
      { id: "1234", email: "verified@example.test", name: "Fixture" },
    );
    expect(
      fetch.mock.calls.every(
        (call) => call[1].redirect === "error" && !!call[1].signal,
      ),
    ).toBe(true);
    const body = fetch.mock.calls[0]![1].body as URLSearchParams;
    expect(body.has("code_verifier")).toBe(true);
  });
  it("fails closed for unverified email and provider failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: "fixture-token" }))
        .mockResolvedValueOnce(Response.json({ id: 1234, login: "Fixture" }))
        .mockResolvedValueOnce(
          Response.json([
            { email: "fixture@example.test", primary: true, verified: false },
          ]),
        ),
    );
    await expect(
      provider.exchange("fixture-code", "fixture-verifier"),
    ).rejects.toThrow("Verified GitHub email required");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    await expect(
      provider.exchange("fixture-code", "fixture-verifier"),
    ).rejects.toThrow("GitHub request failed");
  });
});
