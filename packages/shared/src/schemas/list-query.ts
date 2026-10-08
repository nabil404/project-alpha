import { z } from 'zod';

/** Building blocks the paged list routes share. */

export const sortDirections = ['asc', 'desc'] as const;
export const sortDirectionSchema = z.enum(sortDirections);
export type SortDirection = z.infer<typeof sortDirectionSchema>;

/** An empty `q=` in the URL means no search, not a failed one. */
export const searchTerm = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().max(100).optional(),
);

export const pageNumber = z.coerce.number().int().min(1).max(10_000).default(1);

/** A page size limited to the sizes the page's picker offers. */
export const pageSizeOf = (sizes: readonly number[]) =>
  z.coerce
    .number()
    .int()
    .refine((value) => sizes.includes(value), { params: { code: 'INVALID_VALUE' } })
    .default(10);

export const pagePaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type PagePagination = z.infer<typeof pagePaginationSchema>;
