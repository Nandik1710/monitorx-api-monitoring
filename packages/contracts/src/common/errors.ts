import { z } from "zod";

export const errorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);

export const errorEnvelopeSchema = z
  .object({
    code: errorCodeSchema,
    message: z.string().min(1).max(500),
    requestId: z.string().min(1).max(120),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function createErrorEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  return errorEnvelopeSchema.parse({ code, message, requestId, details });
}
