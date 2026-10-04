import { z } from "zod";
import { emailSchema, authTokenSchema } from "./auth.js";
import {
  organizationCreateSchema,
  projectCreateSchema,
} from "./organizations.js";

export const roleSchema = z.enum(["OWNER", "ADMIN", "EDITOR", "VIEWER"]);
export const actorSchema = z
  .object({ userId: z.string().uuid(), requestId: z.string().uuid() })
  .strict();
export const tenantContextSchema = actorSchema.extend({
  organizationId: z.string().uuid(),
});
export type Actor = z.infer<typeof actorSchema>;
export type TenantContext = z.infer<typeof tenantContextSchema>;
export const resourceIdSchema = z.string().uuid();
export const pageSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type Page = z.infer<typeof pageSchema>;
export const organizationUpdateSchema = organizationCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const projectUpdateSchema = projectCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const variableNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,119}$/);
export const variablesSchema = z
  .record(variableNameSchema, z.string().max(10000))
  .refine((v) => Object.keys(v).length <= 100, "At most 100 variables")
  .refine((v) => utf8ByteLength(v) <= 65536, "Variables exceed the size limit");
// Browser-compatible UTF-8 bound; no Node Buffer dependency in shared contracts.
function utf8ByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
export const workspaceEnvironmentCreateSchema = projectCreateSchema.extend({
  variables: variablesSchema.default({}),
});
export const workspaceEnvironmentUpdateSchema = workspaceEnvironmentCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const secretWriteSchema = z
  .object({ value: z.string().min(1).max(10000) })
  .strict();
export const inviteCreateSchema = z
  .object({ email: emailSchema, role: roleSchema.default("VIEWER") })
  .strict();
export const inviteAcceptSchema = z.object({ token: authTokenSchema }).strict();
export const memberChangeSchema = z.object({ role: roleSchema }).strict();
export const emptyInputSchema = z.object({}).strict();
export const secretMetadataSchema = z
  .object({
    id: z.string().uuid(),
    key: variableNameSchema,
    maskedValue: z.literal("••••••••"),
    keyVersion: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
const timestamps = {
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};
export const organizationViewSchema = organizationCreateSchema.extend({
  id: resourceIdSchema,
  role: roleSchema,
  testTimeoutLimitMs: z.number().int().min(100).max(30000),
  executionRateLimitPerMinute: z.number().int().min(1).max(10000).nullable(),
  ...timestamps,
});
export const projectViewSchema = projectCreateSchema.extend({
  id: resourceIdSchema,
  organizationId: resourceIdSchema,
  archivedAt: z.string().datetime().nullable(),
  ...timestamps,
});
export const environmentViewSchema = workspaceEnvironmentCreateSchema.extend({
  id: resourceIdSchema,
  organizationId: resourceIdSchema,
  projectId: resourceIdSchema,
  ...timestamps,
});
export const memberViewSchema = z
  .object({
    id: resourceIdSchema,
    userId: resourceIdSchema,
    role: roleSchema,
    status: z.enum(["ACTIVE", "INVITED", "SUSPENDED", "REMOVED"]),
    user: z.object({ displayName: z.string(), email: emailSchema }).strict(),
  })
  .strict();
export const invitationViewSchema = inviteCreateSchema.extend({
  id: resourceIdSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
