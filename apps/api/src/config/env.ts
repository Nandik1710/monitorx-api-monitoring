import { config } from "dotenv";
import { authConfigSchema } from "../auth/config.js";

config({ path: new URL("../../../../.env", import.meta.url) });

import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => /^postgres(?:ql)?:\/\//.test(value)),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_VERSION: z.string().min(1).default("0.1.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
});

// Never print validation errors, which may include supplied environment values.
const parsed = environmentSchema.safeParse(process.env);
const parsedAuth = authConfigSchema.safeParse(process.env);
if (!parsed.success || !parsedAuth.success)
  throw new Error("Invalid API configuration. Check the environment example.");
if (
  parsed.data.NODE_ENV === "production" &&
  (!parsedAuth.data.APP_BASE_URL.startsWith("https:") ||
    !parsedAuth.data.API_BASE_URL.startsWith("https:"))
)
  throw new Error("Production authentication requires HTTPS origins.");
export const env = parsed.data;
export const authConfig = parsedAuth.data;
