import { z } from "zod";

export const serviceHealthSchema = z.object({
  service: z.enum(["api", "worker"]),
  status: z.literal("ok"),
  version: z.string().min(1),
  timestamp: z.string().datetime(),
});

export type ServiceHealth = z.infer<typeof serviceHealthSchema>;
