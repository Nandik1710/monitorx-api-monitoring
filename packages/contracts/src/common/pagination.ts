import { z } from "zod";

export const paginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();

export const pageInfoSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
    nextCursor: z.string().min(1).max(200).nullable(),
  })
  .strict();

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type PageInfo = z.infer<typeof pageInfoSchema>;
