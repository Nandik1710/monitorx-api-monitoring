import { z } from "zod";

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and single hyphens",
  );

export const organizationCreateSchema = z
  .object({ name: z.string().trim().min(1).max(120), slug: slugSchema })
  .strict();

export const projectCreateSchema = z
  .object({ name: z.string().trim().min(1).max(120), slug: slugSchema })
  .strict();

export const collectionCreateSchema = z
  .object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(5000).optional(),
  })
  .strict();

export const environmentCreateSchema = z
  .object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    slug: slugSchema,
    variables: z.record(z.string(), z.string().max(10000)).default({}),
  })
  .strict();
