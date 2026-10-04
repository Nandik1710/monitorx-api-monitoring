import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .max(320)
  .email()
  .transform((value) => value.toLowerCase());
export const passwordSchema = z.string().min(12).max(128);
export const authTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(120),
  })
  .strict();
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export const emailRequestSchema = z.object({ email: emailSchema }).strict();
export const verifyEmailSchema = z.object({ token: authTokenSchema }).strict();
export const resetPasswordSchema = z
  .object({ token: authTokenSchema, password: passwordSchema })
  .strict();
export const publicUserSchema = z
  .object({
    id: z.string().uuid(),
    email: emailSchema,
    displayName: z.string(),
    emailVerified: z.boolean(),
  })
  .strict();
export const authResponseSchema = z.object({ user: publicUserSchema }).strict();
export const authErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        requestId: z.string(),
      })
      .strict(),
  })
  .strict();
export type RegisterInput = z.infer<typeof registerSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
