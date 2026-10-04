import {
  apiTestCreateSchema,
  previewTemplate,
  REQUEST_LIMITS,
  sensitiveName,
  credentialReferences,
} from "@monitorx/contracts";
import {
  EngineError,
  type EngineInput,
  type NormalizedRequest,
} from "./types.js";
import { validateUrl } from "./policy.js";

export function normalizeRequest(input: EngineInput): NormalizedRequest {
  const definition = apiTestCreateSchema.parse(input.definition);
  if (
    credentialReferences(definition).some(
      (name) => !Object.hasOwn(input.secrets, name),
    )
  )
    throw new EngineError("configuration_error");
  const values = { ...input.variables, ...input.secrets };
  const expand = (value: string) => {
    const names = [...value.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)].map(
      (m) => m[1]!,
    );
    if (names.some((name) => !Object.hasOwn(values, name)))
      throw new EngineError("configuration_error");
    return previewTemplate(value, values, [], REQUEST_LIMITS.bodyBytes);
  };
  const url = new URL(expand(definition.urlTemplate));
  validateUrl(url);
  for (const row of definition.queryRows.filter((r) => r.enabled))
    url.searchParams.append(row.key, expand(row.value));
  const headers: Record<string, string> = { "accept-encoding": "identity" };
  for (const row of definition.headerRows.filter((r) => r.enabled))
    headers[row.key.toLowerCase()] = expand(row.value);
  const auth = definition.authConfig;
  if (auth.type === "BEARER")
    headers["authorization"] = `Bearer ${expand(auth.token)}`;
  if (auth.type === "BASIC")
    headers["authorization"] =
      `Basic ${Buffer.from(`${expand(auth.username)}:${expand(auth.password)}`).toString("base64")}`;
  if (auth.type === "API_KEY" && auth.in === "QUERY")
    url.searchParams.set(auth.name, expand(auth.value));
  if (
    auth.type === "CUSTOM_HEADER" ||
    (auth.type === "API_KEY" && auth.in === "HEADER")
  )
    headers[auth.name.toLowerCase()] = expand(auth.value);
  let body: string | null =
    definition.bodyTemplate === null ? null : expand(definition.bodyTemplate);
  if (definition.bodyMode === "JSON") {
    // Expand string values after parsing, so quotes in variables cannot inject JSON structure.
    const transform = (value: unknown, depth = 0): unknown => {
      if (depth > 64) throw new EngineError("configuration_error");
      if (typeof value === "string") return expand(value);
      if (Array.isArray(value))
        return value.map((item) => transform(item, depth + 1));
      if (value !== null && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            transform(item, depth + 1),
          ]),
        );
      return value;
    };
    body = JSON.stringify(
      transform(JSON.parse(definition.bodyTemplate ?? "null") as unknown),
    );
    headers["content-type"] ??= "application/json";
  }
  if (definition.bodyMode === "XML")
    headers["content-type"] ??= "application/xml";
  if (definition.bodyMode === "FORM_URLENCODED") {
    body = new URLSearchParams(
      definition.formRows
        .filter((r) => r.enabled)
        .map((r) => [r.key, expand(r.value)]),
    ).toString();
    headers["content-type"] ??= "application/x-www-form-urlencoded";
  }
  if (definition.bodyMode === "NONE") body = null;
  if (
    Buffer.byteLength(body ?? "") > REQUEST_LIMITS.bodyBytes ||
    Buffer.byteLength(JSON.stringify(headers)) > REQUEST_LIMITS.headerBytes ||
    Object.values(headers).some((v) => /[\r\n\0]/.test(v))
  )
    throw new EngineError("configuration_error");
  validateUrl(url);
  return { url, method: definition.method, headers, body };
}
export function createRedactor(
  secrets: Record<string, string>,
  request?: NormalizedRequest,
): (value: unknown) => unknown {
  const hidden = new Set(Object.values(secrets).filter(Boolean));
  for (const [key, value] of Object.entries(request?.headers ?? {}))
    if (sensitiveName(key)) hidden.add(value);
  for (const value of [...hidden]) {
    hidden.add(encodeURIComponent(value));
    hidden.add(Buffer.from(value).toString("base64"));
    hidden.add(JSON.stringify(value).slice(1, -1));
  }
  const ordered = [...hidden].sort((a, b) => b.length - a.length);
  const scrub = (value: unknown, depth = 0): unknown => {
    if (depth > 64) return "[omitted]";
    if (typeof value === "string") {
      let clean = value;
      for (const secret of ordered)
        clean = clean.split(secret).join("[REDACTED]");
      return clean;
    }
    if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          String(scrub(key, depth + 1)),
          sensitiveName(key) ? "[REDACTED]" : scrub(item, depth + 1),
        ]),
      );
    return value;
  };
  return scrub;
}
