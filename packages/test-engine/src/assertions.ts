import { RE2 } from "re2-wasm";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { sensitiveName, type Assertion } from "@monitorx/contracts";
import type { AssertionOutcome } from "./types.js";

function jsonPath(root: unknown, path: string): unknown {
  if (!/^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d{1,6}\])*$/.test(path))
    throw Error("Unsupported path");
  let value = root;
  for (const token of path.slice(1).match(/[A-Za-z_][A-Za-z0-9_]*|\d+/g) ??
    []) {
    if (["__proto__", "prototype", "constructor"].includes(token))
      throw Error("Unsafe path");
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, token)
    )
      return undefined;
    value = (value as Record<string, unknown>)[token];
  }
  return value;
}
function xmlPath(body: string, path: string): unknown {
  // Deliberately bounded XPath subset: absolute child elements, namespace-local names.
  if (
    !/^\/(?:[A-Za-z_][\w.-]*\/)*[A-Za-z_][\w.-]*$/.test(path) ||
    /<!DOCTYPE|<!ENTITY/i.test(body) ||
    XMLValidator.validate(body) !== true
  )
    throw Error("Unsafe XML or unsupported path");
  const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
    parseTagValue: false,
    processEntities: false,
  });
  let value: unknown = parser.parse(body);
  for (const part of path.slice(1).split("/")) {
    if (
      ["__proto__", "constructor", "prototype"].includes(part) ||
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, part)
    )
      return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
export function evaluateAssertions(
  assertions: Assertion[],
  response: {
    status: number;
    latencyMs: number;
    headers: Record<string, string>;
    body: string;
  },
): AssertionOutcome[] {
  let json: unknown;
  try {
    json = JSON.parse(response.body) as unknown;
  } catch {
    /* Non-JSON assertions remain independent. */
  }
  return assertions.map((assertion, position) => {
    let actual: unknown = null;
    let passed = false;
    let message = "Assertion failed.";
    try {
      switch (assertion.type) {
        case "status":
          actual = response.status;
          passed = Array.isArray(assertion.expected)
            ? assertion.expected.includes(response.status)
            : response.status === assertion.expected;
          break;
        case "latency":
          actual = response.latencyMs;
          passed = response.latencyMs < assertion.expected;
          break;
        case "header":
          actual = response.headers[assertion.name.toLowerCase()];
          passed =
            assertion.operator === "exists"
              ? actual !== undefined
              : typeof actual === "string" &&
                (assertion.operator === "equals"
                  ? actual === assertion.expected
                  : actual.includes(assertion.expected));
          break;
        case "json_path":
          actual = jsonPath(json, assertion.path);
          passed = actual !== undefined;
          break;
        case "json_compare": {
          actual = jsonPath(json, assertion.path);
          if (assertion.operator === "equals")
            passed = actual === assertion.expected;
          else if (assertion.operator === "not_equals")
            passed = actual !== undefined && actual !== assertion.expected;
          else if (
            typeof actual === "number" &&
            typeof assertion.expected === "number"
          ) {
            const expected = assertion.expected;
            passed =
              assertion.operator === "gt"
                ? actual > expected
                : assertion.operator === "gte"
                  ? actual >= expected
                  : assertion.operator === "lt"
                    ? actual < expected
                    : actual <= expected;
          }
          break;
        }
        case "text":
          actual = "[body omitted]";
          passed =
            assertion.operator === "equals"
              ? response.body === assertion.expected
              : response.body.includes(assertion.expected);
          break;
        case "regex":
          if (response.body.length > 65536) throw Error("Regex input limit");
          actual = "[body omitted]";
          passed = new RE2(assertion.pattern, `${assertion.flags}u`).test(
            response.body,
          );
          break;
        case "xpath":
          actual = xmlPath(response.body, assertion.path);
          passed = actual === assertion.expected;
          break;
      }
      if (passed) message = "Assertion passed.";
    } catch {
      message = "Invalid assertion or unsupported response/path/pattern.";
    }
    if (
      assertion.type === "xpath" ||
      ("path" in assertion && sensitiveName(assertion.path))
    )
      actual = "[REDACTED]";
    // Bound result cardinality and size even when a path points at the full response.
    if (JSON.stringify(actual ?? null).length > 2048)
      actual = "[value omitted: too large]";
    return {
      position,
      type: assertion.type,
      severity: assertion.severity,
      expected:
        "expected" in assertion
          ? assertion.expected
          : "pattern" in assertion
            ? assertion.pattern
            : assertion.path,
      actual: actual ?? null,
      passed,
      message,
    };
  });
}
