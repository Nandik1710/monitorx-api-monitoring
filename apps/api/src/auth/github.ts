import { createHash } from "node:crypto";
import { z } from "zod";
import type { AuthConfig } from "./config.js";

export interface GitHubProvider {
  authorize(state: string, verifier: string): string;
  exchange(
    code: string,
    verifier: string,
  ): Promise<{ id: string; email: string; name: string }>;
}

export function createGitHubProvider(config: AuthConfig): GitHubProvider {
  const callback = `${config.API_BASE_URL}/api/v1/auth/github/callback`;
  async function json(url: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("GitHub request failed");
    return response.json();
  }
  return {
    authorize(state, verifier) {
      const params = new URLSearchParams({
        client_id: config.GITHUB_CLIENT_ID ?? "",
        redirect_uri: callback,
        scope: "read:user user:email",
        state,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      });
      return `https://github.com/login/oauth/authorize?${params}`;
    },
    async exchange(code, verifier) {
      const token = z.object({ access_token: z.string().min(1) }).parse(
        await json("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: config.GITHUB_CLIENT_ID ?? "",
            client_secret: config.GITHUB_CLIENT_SECRET ?? "",
            code,
            redirect_uri: callback,
            code_verifier: verifier,
          }),
        }),
      );
      const headers = {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      const user = z
        .object({
          id: z.number().int().positive().safe(),
          login: z.string().min(1),
        })
        .parse(await json("https://api.github.com/user", { headers }));
      const emails = z
        .array(
          z.object({
            email: z.string().email().max(320),
            primary: z.boolean(),
            verified: z.boolean(),
          }),
        )
        .parse(await json("https://api.github.com/user/emails", { headers }));
      const email = emails
        .find((item) => item.primary && item.verified)
        ?.email.toLowerCase();
      if (!email) throw new Error("Verified GitHub email required");
      return { id: String(user.id), email, name: user.login.slice(0, 120) };
    },
  };
}
