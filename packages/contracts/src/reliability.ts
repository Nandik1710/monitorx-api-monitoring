import { z } from "zod";
import { runViewSchema } from "./executions.js";

export const historyQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    status: z
      .enum(["QUEUED", "RUNNING", "PASSED", "DEGRADED", "FAILED", "CANCELLED"])
      .optional(),
    environmentId: z.string().uuid().optional(),
    tag: z.string().min(1).max(40).optional(),
    runKind: z.enum(["MANUAL", "COLLECTION", "SCHEDULED"]).optional(),
  })
  .strict()
  .refine(
    (q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to),
    "Invalid time range",
  );
export const metricsQuerySchema = z
  .object({ range: z.enum(["24h", "7d", "30d"]).default("24h") })
  .strict();
export const historyItemSchema = runViewSchema
  .extend({
    testName: z.string(),
    environmentId: z.string().uuid().nullable(),
    runKind: z.string(),
    startedAt: z.string().nullable(),
  })
  .strict();
export const historyPageSchema = z
  .object({
    items: z.array(historyItemSchema),
    total: z.number().int().nonnegative(),
    page: z.number(),
    limit: z.number(),
  })
  .strict();
export const executionDetailSchema = historyItemSchema
  .extend({
    errorMessage: z.string().nullable(),
    requestMetadata: z.unknown(),
    responsePreview: z.string().nullable(),
    previewExpired: z.boolean(),
    responseBytes: z.number().nullable(),
    assertions: z.array(
      z
        .object({
          position: z.number(),
          type: z.string(),
          severity: z.string(),
          passed: z.boolean(),
          expected: z.unknown(),
          actual: z.unknown(),
          message: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export const healthSchema = z.enum([
  "HEALTHY",
  "DEGRADED",
  "DOWN",
  "PAUSED",
  "UNKNOWN",
]);
const endpointSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    health: healthSchema,
    averageMs: z.number().nullable(),
  })
  .strict();
export const dashboardSchema = z
  .object({
    name: z.string(),
    range: metricsQuerySchema.shape.range,
    generatedAt: z.string(),
    summary: z
      .object({
        samples: z.number(),
        scheduledSamples: z.number(),
        uptime: z.number().nullable(),
        passRate: z.number().nullable(),
        averageMs: z.number().nullable(),
        p50: z.number().nullable(),
        p95: z.number().nullable(),
        p99: z.number().nullable(),
      })
      .strict(),
    health: z.array(
      z.object({ state: healthSchema, count: z.number() }).strict(),
    ),
    errors: z.array(
      z.object({ errorClass: z.string(), count: z.number() }).strict(),
    ),
    degraded: z.array(endpointSchema),
    slowest: z.array(endpointSchema),
    openIncidents: z.number(),
    incidents: z.array(
      z
        .object({
          id: z.string().uuid(),
          testName: z.string(),
          state: z.string(),
          openedAt: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type Dashboard = z.infer<typeof dashboardSchema>;
export type ReliabilityScope = "projects" | "collections" | "tests";
