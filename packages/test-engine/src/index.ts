import { performance } from "node:perf_hooks";
import { apiTestCreateSchema, sensitiveName } from "@monitorx/contracts";
import { normalizeRequest, createRedactor } from "./normalize.js";
import { evaluateAssertions } from "./assertions.js";
import { validateDestination, type Resolver } from "./policy.js";
import { boundedRequest, type Transport } from "./transport.js";
import {
  EngineError,
  type EngineInput,
  type EngineResult,
  type ErrorClass,
} from "./types.js";
export type {
  EngineInput,
  EngineResult,
  AssertionOutcome,
  ErrorClass,
} from "./types.js";
export { isPublicAddress, validateDestination } from "./policy.js";
export { normalizeRequest, createRedactor } from "./normalize.js";
export { evaluateAssertions } from "./assertions.js";

function classify(error: unknown): ErrorClass {
  if (error instanceof EngineError) return error.kind;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code))
    return "tls_error";
  if (/HPE_|Z_DATA|Z_BUF/.test(code)) return "response_error";
  return "network_error";
}
// Dependency injection is for controlled tests; no tenant/API option can change outbound policy.
export async function executeTest(
  input: EngineInput,
  dependencies: {
    resolver?: Resolver;
    transport?: Transport;
    signal?: AbortSignal;
  } = {},
): Promise<EngineResult> {
  const started = performance.now();
  const result: EngineResult = {
    status: "FAILED",
    healthState: "DOWN",
    latencyMs: 0,
    httpStatus: null,
    responseBytes: 0,
    responsePreview: null,
    requestMetadata: {},
    errorClass: null,
    errorMessage: null,
    assertions: [],
  };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => controller.abort(new EngineError("cancelled"));
  dependencies.signal?.addEventListener("abort", cancel, { once: true });
  if (dependencies.signal?.aborted) cancel();
  let redact = createRedactor(input.secrets);
  try {
    const parsed = apiTestCreateSchema.safeParse(input.definition);
    if (!parsed.success) throw new EngineError("configuration_error");
    let request: ReturnType<typeof normalizeRequest>;
    try {
      request = normalizeRequest(input);
    } catch {
      throw new EngineError("configuration_error");
    }
    redact = createRedactor(input.secrets, request);
    const metadataHeaders = { ...request.headers };
    for (const row of input.definition.headerRows)
      if (row.sensitive) metadataHeaders[row.key.toLowerCase()] = "[REDACTED]";
    const safeUrl = new URL(request.url);
    for (const key of [...safeUrl.searchParams.keys()])
      safeUrl.searchParams.set(key, "[REDACTED]");
    result.requestMetadata = {
      method: request.method,
      url: safeUrl.href,
      headers: metadataHeaders,
      bodyBytes: Buffer.byteLength(request.body ?? ""),
    };
    timer = setTimeout(
      () => controller.abort(new EngineError("timeout")),
      parsed.data.timeoutMs,
    );
    const aborted = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(controller.signal.reason);
      else
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason),
          { once: true },
        );
    });
    const run = async () => {
      for (let hop = 0; ; hop++) {
        controller.signal.throwIfAborted();
        const address = await validateDestination(
          request.url,
          dependencies.resolver,
        );
        controller.signal.throwIfAborted();
        const response = await (dependencies.transport ?? boundedRequest)(
          request,
          address,
          controller.signal,
        );
        if (
          [301, 302, 303, 307, 308].includes(response.status) &&
          response.headers["location"] &&
          input.definition.followRedirects
        ) {
          if (hop >= input.definition.maxRedirects)
            throw new EngineError("response_error");
          const next = new URL(response.headers["location"], request.url);
          await validateDestination(next, dependencies.resolver);
          // Cross-origin forwarding is refused, including possible body/query credentials.
          if (next.origin !== request.url.origin)
            throw new EngineError("configuration_error");
          if (
            response.status === 303 ||
            ([301, 302].includes(response.status) && request.method === "POST")
          )
            request = { ...request, method: "GET", body: null };
          request.url = next;
          continue;
        }
        return response;
      }
    };
    const response = await Promise.race([run(), aborted]);
    result.httpStatus = response.status;
    result.responseBytes = response.body.length;
    result.latencyMs = Math.round(performance.now() - started);
    const charset =
      /charset\s*=\s*"?([^;"\s]+)/i.exec(
        response.headers["content-type"] ?? "",
      )?.[1] ?? "utf-8";
    let body: string;
    try {
      body = new TextDecoder(charset, { fatal: true }).decode(response.body);
    } catch {
      throw new EngineError("response_error");
    }
    result.assertions = evaluateAssertions(input.definition.assertions, {
      status: response.status,
      latencyMs: result.latencyMs,
      headers: response.headers,
      body,
    });
    // Never persist a raw non-JSON body: XML/text may contain unexpected credentials.
    try {
      const safe = redact(JSON.parse(body) as unknown);
      result.responsePreview = Buffer.from(JSON.stringify(safe))
        .subarray(0, 65536)
        .toString("utf8");
    } catch {
      result.responsePreview = "[Non-JSON response preview omitted for safety]";
    }
    for (const assertion of result.assertions) {
      if (assertion.type === "header") {
        const configured = input.definition.assertions[assertion.position];
        if (
          configured?.type === "header" &&
          (sensitiveName(configured.name) ||
            input.definition.headerRows.some(
              (r) =>
                r.sensitive &&
                r.key.toLowerCase() === configured.name.toLowerCase(),
            ))
        )
          assertion.actual = "[REDACTED]";
      }
    }
    const failed = result.assertions.some(
      (a) => !a.passed && a.severity === "REQUIRED",
    );
    const warning = result.assertions.some((a) => !a.passed);
    const httpFailure =
      response.status >= 400 &&
      !input.definition.assertions.some((a) => a.type === "status");
    result.status = failed || httpFailure ? "FAILED" : "PASSED";
    result.healthState =
      result.status === "FAILED" ? "DOWN" : warning ? "DEGRADED" : "HEALTHY";
    if (failed || httpFailure) result.errorClass = "assertion_failure";
  } catch (error) {
    result.errorClass = controller.signal.aborted
      ? classify(controller.signal.reason)
      : classify(error);
    result.errorMessage = `Check ended: ${result.errorClass}.`;
    if (result.errorClass === "cancelled") {
      result.status = "CANCELLED";
      result.healthState = "UNKNOWN";
    }
  } finally {
    if (timer) clearTimeout(timer);
    dependencies.signal?.removeEventListener("abort", cancel);
    result.latencyMs = Math.round(performance.now() - started);
  }
  result.requestMetadata = redact(result.requestMetadata) as Record<
    string,
    unknown
  >;
  result.assertions = result.assertions.map((assertion) => ({
    ...assertion,
    expected: redact(assertion.expected),
    actual: redact(assertion.actual),
  }));
  return result;
}
