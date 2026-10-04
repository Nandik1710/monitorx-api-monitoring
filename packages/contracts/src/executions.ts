import { z } from "zod";
import { apiTestCreateSchema } from "./request-definition.js";
import { variablesSchema } from "./workspaces.js";
export const runInputSchema = z
  .object({ environmentId: z.string().uuid() })
  .strict();
export const collectionRunInputSchema = runInputSchema
  .extend({ parallelism: z.number().int().min(1).max(5).default(2) })
  .strict();
export const executionSnapshotSchema = z
  .object({
    definition: apiTestCreateSchema,
    revision: z.number().int().positive(),
    variables: variablesSchema,
    secrets: z
      .array(
        z
          .object({
            key: z.string(),
            ciphertext: z.string(),
            keyVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const runViewSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  healthState: z.string(),
  testId: z.string().uuid(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  latencyMs: z.number().nullable(),
  httpStatus: z.number().nullable(),
  errorClass: z.string().nullable(),
  cancelRequested: z.boolean(),
});
export const executionEventSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
    type: z.enum([
      "execution.queued",
      "execution.started",
      "execution.completed",
    ]),
    executionId: z.string().uuid(),
    testId: z.string().uuid(),
    status: z.string(),
    runKind: z.string(),
    latencyMs: z.number().nullable(),
    httpStatus: z.number().nullable(),
    createdAt: z.string(),
  })
  .strict();
