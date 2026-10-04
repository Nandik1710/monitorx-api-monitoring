import { z } from "zod";
export * from "./auth.js";
export * from "./workspaces.js";

export {
  createErrorEnvelope,
  errorCodeSchema,
  errorEnvelopeSchema,
} from "./common/errors.js";
export type { ErrorCode, ErrorEnvelope } from "./common/errors.js";
export { pageInfoSchema, paginationQuerySchema } from "./common/pagination.js";
export type { PageInfo, PaginationQuery } from "./common/pagination.js";
export {
  collectionCreateSchema,
  environmentCreateSchema,
  organizationCreateSchema,
  projectCreateSchema,
} from "./organizations.js";
export { scheduleCreateSchema } from "./tests.js";
export * from "./request-definition.js";

export const serviceHealthSchema = z.object({
  service: z.enum(["api", "worker"]),
  status: z.literal("ok"),
  version: z.string().min(1),
  timestamp: z.string().datetime(),
});

export type ServiceHealth = z.infer<typeof serviceHealthSchema>;
export * from "./executions.js";
export * from "./schedules.js";
export * from "./reliability.js";
