import { z } from "zod";

export { apiTestCreateSchema } from "./request-definition.js";

export const scheduleCreateSchema = z
  .object({
    testId: z.string().uuid(),
    intervalMinutes: z
      .union([
        z.literal(1),
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(30),
        z.literal(60),
      ])
      .optional(),
    cronExpression: z.string().trim().max(120).optional(),
    timeZone: z.string().trim().min(1).max(64).default("UTC"),
    enabled: z.boolean().default(true),
  })
  .strict();
