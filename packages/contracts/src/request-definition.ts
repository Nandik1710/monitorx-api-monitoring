import { z } from "zod";

export const REQUEST_LIMITS = {
  timeoutMs: 30000,
  bodyBytes: 262144,
  headerBytes: 16384,
  rows: 100,
  redirects: 3,
} as const;
export const STANDARD_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;
export const MASK = "••••••••";
export const byteLength = (value: string): number =>
  new TextEncoder().encode(value).length;
const hasControl = (value: string): boolean =>
  [...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
export const sensitiveName = (name: string): boolean =>
  /authorization|cookie|api[-_]?key|token|secret|password/i.test(name);
const reference = /\{\{([A-Z][A-Z0-9_]{0,119})\}\}/g;
export function templateReferences(value: string): string[] {
  return [...new Set([...value.matchAll(reference)].map((match) => match[1]!))];
}
export function validTemplate(value: string): boolean {
  const remainder = value.replace(reference, "");
  // Adjacent closing braces are also valid nested JSON, so only unmatched
  // opening delimiters are errors. Recognized references have already gone.
  return !remainder.includes("{{");
}
// Single-pass preview only. Never recursively expand a variable or decrypt a secret.
export function previewTemplate(
  value: string,
  variables: Record<string, string>,
  secrets: readonly string[],
  maxBytes: number = REQUEST_LIMITS.bodyBytes,
): string {
  const parts: string[] = [];
  let bytes = 0;
  let offset = 0;
  const append = (part: string) => {
    bytes += byteLength(part);
    if (bytes > maxBytes)
      throw new Error("Expanded preview exceeds its size limit.");
    parts.push(part);
  };
  for (const match of value.matchAll(reference)) {
    append(value.slice(offset, match.index));
    const key = match[1]!;
    append(
      secrets.includes(key)
        ? MASK
        : Object.hasOwn(variables, key)
          ? variables[key]!
          : match[0],
    );
    offset = match.index + match[0].length;
  }
  append(value.slice(offset));
  return parts.join("");
}
const template = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      validTemplate,
      "Use variables like {{BASE_URL}} with uppercase names and no spaces.",
    );
const secretReference = z
  .string()
  .regex(
    /^\{\{[A-Z][A-Z0-9_]{0,119}\}\}$/,
    "Use an environment secret reference, not a credential value.",
  );
export const keyValueRowSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(200)
      .refine((v) => !hasControl(v), "Keys cannot contain control characters."),
    value: template(10000),
    enabled: z.boolean().default(true),
    sensitive: z.boolean().default(false),
  })
  .strict();
export type KeyValueRow = z.infer<typeof keyValueRowSchema>;
const headerName = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "Use a valid HTTP header name.");
export const authConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NONE") }).strict(),
  z.object({ type: z.literal("BEARER"), token: secretReference }).strict(),
  z
    .object({
      type: z.literal("BASIC"),
      username: template(1000).refine(
        (v) => v.length > 0,
        "Username is required.",
      ),
      password: secretReference,
    })
    .strict(),
  z
    .object({
      type: z.literal("API_KEY"),
      in: z.enum(["HEADER", "QUERY"]),
      name: headerName,
      value: secretReference,
    })
    .strict(),
  z
    .object({
      type: z.literal("CUSTOM_HEADER"),
      name: headerName,
      value: secretReference,
    })
    .strict(),
]);
const severity = z.enum(["REQUIRED", "WARNING"]).default("REQUIRED");
const expected = z.union([
  z.string().max(10000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const path = z.string().min(1).max(500);
export const assertionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("status"),
      severity,
      expected: z.union([
        z.number().int().min(100).max(599),
        z.array(z.number().int().min(100).max(599)).min(1).max(20),
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("latency"),
      severity,
      expected: z.number().int().min(1).max(30000),
    })
    .strict(),
  z
    .object({
      type: z.literal("header"),
      severity,
      name: headerName,
      operator: z.enum(["exists", "equals", "contains"]),
      expected: z.string().max(10000),
    })
    .strict(),
  z
    .object({ type: z.literal("json_path"), severity, path: path.regex(/^\$/) })
    .strict(),
  z
    .object({
      type: z.literal("json_compare"),
      severity,
      path: path.regex(/^\$/),
      operator: z.enum(["equals", "not_equals", "gt", "gte", "lt", "lte"]),
      expected,
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      severity,
      operator: z.enum(["equals", "contains"]),
      expected: z.string().min(1).max(10000),
    })
    .strict(),
  z
    .object({
      type: z.literal("regex"),
      severity,
      pattern: z.string().min(1).max(500),
      flags: z.enum(["", "i", "m", "im"]).default(""),
    })
    .strict(),
  z
    .object({
      type: z.literal("xpath"),
      severity,
      path,
      expected: z.string().max(10000),
    })
    .strict(),
]);
export type Assertion = z.infer<typeof assertionSchema>;

export const apiTestFieldsSchema = z
  .object({
    projectId: z.string().uuid(),
    collectionId: z.string().uuid(),
    environmentId: z.string().uuid().nullable().default(null),
    name: z.string().trim().min(1).max(160),
    method: z
      .string()
      .min(1)
      .max(16)
      .regex(/^[A-Z]+$/),
    advancedMethod: z.boolean().default(false),
    urlTemplate: template(2048).refine(
      (v) => v.length > 0 && !/[\s\\]/.test(v) && !hasControl(v),
      "URL is required and cannot contain spaces or backslashes.",
    ),
    queryRows: z.array(keyValueRowSchema).max(100).default([]),
    headerRows: z.array(keyValueRowSchema).max(100).default([]),
    bodyMode: z
      .enum(["NONE", "JSON", "RAW", "XML", "FORM_URLENCODED"])
      .default("NONE"),
    bodyTemplate: template(REQUEST_LIMITS.bodyBytes).nullable().default(null),
    formRows: z.array(keyValueRowSchema).max(100).default([]),
    authConfig: authConfigSchema.default({ type: "NONE" }),
    timeoutMs: z
      .number()
      .int()
      .min(100)
      .max(REQUEST_LIMITS.timeoutMs)
      .default(10000),
    followRedirects: z.boolean().default(false),
    maxRedirects: z
      .number()
      .int()
      .min(0)
      .max(REQUEST_LIMITS.redirects)
      .default(0),
    assertions: z.array(assertionSchema).max(100).default([]),
    tags: z.array(z.string().trim().min(1).max(50)).max(50).default([]),
    enabled: z.boolean().default(false),
  })
  .strict();
export type TestDefinition = z.infer<typeof apiTestFieldsSchema>;

export function requestStrings(input: TestDefinition): string[] {
  return [
    input.urlTemplate,
    input.bodyTemplate ?? "",
    ...[...input.queryRows, ...input.headerRows, ...input.formRows].map(
      (row) => row.value,
    ),
    ...Object.values(input.authConfig),
  ];
}
export function credentialReferences(input: TestDefinition): string[] {
  const auth = input.authConfig;
  return [
    ...[...input.queryRows, ...input.headerRows, ...input.formRows]
      .filter((row) => row.sensitive || sensitiveName(row.key))
      .flatMap((row) => templateReferences(row.value)),
    ...templateReferences(
      auth.type === "BEARER"
        ? auth.token
        : auth.type === "BASIC"
          ? auth.password
          : auth.type === "NONE"
            ? ""
            : auth.value,
    ),
    ...[...new URLSearchParams(input.urlTemplate.split("?")[1] ?? "")]
      .filter(([key]) => sensitiveName(key))
      .flatMap(([, value]) => templateReferences(value)),
  ];
}
export const apiTestCreateSchema = apiTestFieldsSchema.superRefine((v, ctx) => {
  const issue = (field: string, message: string) =>
    ctx.addIssue({ code: "custom", path: field.split("."), message });
  if (
    !v.advancedMethod &&
    !(STANDARD_METHODS as readonly string[]).includes(v.method)
  )
    issue("method", "Enable advanced mode for custom methods.");
  if (["CONNECT", "TRACE", "TRACK"].includes(v.method))
    issue("method", "This method is not supported.");
  if (v.enabled && !v.environmentId)
    issue("environmentId", "Select an environment before enabling a test.");
  if (
    (v.followRedirects && v.maxRedirects < 1) ||
    (!v.followRedirects && v.maxRedirects !== 0)
  )
    issue(
      "maxRedirects",
      "Use zero redirects when disabled, or 1–3 when enabled.",
    );
  if ((v.method === "GET" || v.method === "HEAD") && v.bodyMode !== "NONE")
    issue("bodyMode", "GET and HEAD requests must use no body.");
  if (v.bodyMode === "NONE" && v.bodyTemplate)
    issue("bodyTemplate", "No-body mode cannot contain a body.");
  if (v.bodyMode !== "FORM_URLENCODED" && v.formRows.length)
    issue("formRows", "Form rows require form-urlencoded mode.");
  if (v.bodyMode === "FORM_URLENCODED" && v.bodyTemplate)
    issue("bodyTemplate", "Use form rows for form-urlencoded bodies.");
  if (["JSON", "RAW", "XML"].includes(v.bodyMode) && !v.bodyTemplate)
    issue("bodyTemplate", "Enter a body for the selected mode.");
  if (
    byteLength(v.bodyTemplate ?? "") > REQUEST_LIMITS.bodyBytes ||
    byteLength(
      new URLSearchParams(
        v.formRows.filter((r) => r.enabled).map((r) => [r.key, r.value]),
      ).toString(),
    ) > REQUEST_LIMITS.bodyBytes
  )
    issue("bodyTemplate", "Body exceeds the 256 KiB limit.");
  if (v.bodyMode === "JSON") {
    try {
      JSON.parse(v.bodyTemplate ?? "");
    } catch {
      issue(
        "bodyTemplate",
        "Enter valid JSON; put variable references inside JSON strings.",
      );
    }
  }
  if (byteLength(JSON.stringify(v.headerRows)) > REQUEST_LIMITS.headerBytes)
    issue("headerRows", "Headers exceed the 16 KiB limit.");
  const names = new Set<string>();
  v.headerRows.forEach((row, i) => {
    if (!headerName.safeParse(row.key).success || hasControl(row.value))
      issue(`headerRows.${i}`, "Invalid header name or control characters.");
    const name = row.key.toLowerCase();
    if (
      [
        "host",
        "content-length",
        "transfer-encoding",
        "connection",
        "upgrade",
        "proxy-authorization",
        "proxy-connection",
      ].includes(name)
    )
      issue(
        `headerRows.${i}.key`,
        "This transport header is managed by the worker.",
      );
    if (row.enabled && names.has(name))
      issue(`headerRows.${i}.key`, "Duplicate enabled header.");
    if (row.enabled) names.add(name);
  });
  for (const [group, rows] of [
    ["headerRows", v.headerRows],
    ["queryRows", v.queryRows],
    ["formRows", v.formRows],
  ] as const)
    rows.forEach((row, i) => {
      if (
        (row.sensitive || sensitiveName(row.key)) &&
        !/^(?:Bearer |Basic )?\{\{[A-Z][A-Z0-9_]{0,119}\}\}$/.test(row.value)
      )
        issue(
          `${group}.${i}.value`,
          "Sensitive values must reference an environment secret.",
        );
    });
  const authName =
    v.authConfig.type === "BEARER" || v.authConfig.type === "BASIC"
      ? "authorization"
      : v.authConfig.type === "CUSTOM_HEADER" ||
          (v.authConfig.type === "API_KEY" && v.authConfig.in === "HEADER")
        ? v.authConfig.name.toLowerCase()
        : null;
  if (authName && names.has(authName))
    issue("authConfig", "Authentication conflicts with an enabled header.");
  if (
    authName &&
    [
      "host",
      "content-length",
      "transfer-encoding",
      "connection",
      "upgrade",
      "proxy-authorization",
      "proxy-connection",
    ].includes(authName)
  )
    issue("authConfig", "This authentication header is not allowed.");
  const auth = v.authConfig;
  if (
    auth.type === "API_KEY" &&
    auth.in === "QUERY" &&
    v.queryRows.some((r) => r.enabled && r.key === auth.name)
  )
    issue("authConfig", "Authentication conflicts with an enabled query row.");
  try {
    const substituted = v.urlTemplate.replace(reference, (token) =>
      v.urlTemplate.startsWith(token)
        ? "https://template.invalid"
        : "placeholder",
    );
    const url = new URL(substituted);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      !url.hostname
    )
      throw new Error();
    for (const [key, value] of new URLSearchParams(
      v.urlTemplate.split("?")[1] ?? "",
    ))
      if (sensitiveName(key) && !secretReference.safeParse(value).success)
        issue(
          "urlTemplate",
          "Sensitive URL parameters must reference an environment secret.",
        );
  } catch {
    issue(
      "urlTemplate",
      "Use an absolute HTTP(S) URL or {{BASE_URL}}; credentials and fragments are not allowed.",
    );
  }
  if (new Set(v.tags).size !== v.tags.length)
    issue("tags", "Tags must be unique.");
});
export const apiTestUpdateSchema = apiTestFieldsSchema
  .omit({ projectId: true })
  .partial()
  .extend({ expectedRevision: z.number().int().positive() })
  .strict()
  .refine((v) => Object.keys(v).length > 1, "Provide at least one change.");
export const testViewSchema = apiTestFieldsSchema.extend({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TestView = z.infer<typeof testViewSchema>;
export const collectionUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const collectionViewSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const previewViewSchema = z
  .object({
    url: z.string(),
    queryRows: z.array(keyValueRowSchema),
    headerRows: z.array(keyValueRowSchema),
    body: z.string().nullable(),
    formRows: z.array(keyValueRowSchema),
    auth: z.record(z.string(), z.string()),
    variables: z.record(z.string(), z.string()),
    secretNames: z.array(z.string()),
    notice: z.string(),
  })
  .strict();

// Never include unknown property names, enum inputs or request values in validation errors.
export function definitionErrors(error: z.ZodError): string {
  const fields = new Set([
    ...Object.keys(apiTestFieldsSchema.shape),
    "expectedRevision",
    "description",
  ]);
  return [
    ...new Set(
      error.issues.slice(0, 8).map((issue) => {
        const field =
          typeof issue.path[0] === "string" && fields.has(issue.path[0])
            ? issue.path[0]
            : "definition";
        return `${field}: ${issue.code === "custom" ? issue.message : "Invalid value or unsupported field; check the documented limits."}`;
      }),
    ),
  ]
    .join(" ")
    .slice(0, 1000);
}
