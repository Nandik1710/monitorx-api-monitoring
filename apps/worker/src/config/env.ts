import "dotenv/config";

import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_VERSION: z.string().min(1).default("0.1.0"),
  WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
});

export const env = environmentSchema.parse(process.env);
