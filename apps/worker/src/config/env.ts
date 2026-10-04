import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url) });

import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_VERSION: z.string().min(1).default("0.1.0"),
  WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
});

const parsed = environmentSchema.safeParse(process.env);
if (!parsed.success)
  throw Error("Invalid worker configuration; check environment examples.");
export const env = parsed.data;
