import { z } from "zod";
import { authTokenSchema, authErrorResponseSchema } from "@monitorx/contracts";

const base = String(
  import.meta.env["VITE_API_BASE_URL"] ?? "http://localhost:4000",
);
export async function workspaceRequest(
  path: string,
  method = "GET",
  body?: unknown,
  organizationId?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (organizationId) headers["X-Organization-Id"] = organizationId;
  if (method !== "GET") {
    const csrfResponse = await fetch(`${base}/api/v1/auth/csrf`, {
      credentials: "include",
    });
    if (!csrfResponse.ok)
      throw new Error(
        "Unable to verify this request. Sign in again or retry later.",
      );
    const csrf = z
      .object({ csrfToken: authTokenSchema })
      .parse(await csrfResponse.json());
    headers["X-CSRF-Token"] = csrf.csrfToken;
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers,
    credentials: "include",
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  if (response.status === 204) return undefined;
  const data: unknown = await response.json();
  if (response.status === 401 && !path.startsWith("/auth/"))
    window.dispatchEvent(new Event("monitorx:session-expired"));
  if (!response.ok) {
    const error = authErrorResponseSchema.safeParse(data);
    throw new Error(
      error.success ? error.data.error.message : "Request failed.",
    );
  }
  return data;
}
