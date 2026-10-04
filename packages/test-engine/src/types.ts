import type { TestDefinition } from "@monitorx/contracts";
export type ErrorClass =
  | "configuration_error"
  | "network_error"
  | "timeout"
  | "tls_error"
  | "response_error"
  | "assertion_failure"
  | "cancelled";
export class EngineError extends Error {
  constructor(readonly kind: ErrorClass) {
    super(kind);
  }
}
export interface EngineInput {
  definition: TestDefinition;
  variables: Record<string, string>;
  secrets: Record<string, string>;
}
export interface NormalizedRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}
export interface AssertionOutcome {
  position: number;
  type: string;
  severity: "REQUIRED" | "WARNING";
  expected: unknown;
  actual: unknown;
  passed: boolean;
  message: string;
}
export interface EngineResult {
  status: "PASSED" | "FAILED" | "CANCELLED";
  healthState: "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";
  latencyMs: number;
  httpStatus: number | null;
  errorClass: ErrorClass | null;
  errorMessage: string | null;
  responseBytes: number;
  responsePreview: string | null;
  requestMetadata: Record<string, unknown>;
  assertions: AssertionOutcome[];
}
