import { z } from 'zod';

/**
 * Catalog > Import: turning the connected Page's posts into draft products.
 * A run reads the posts in a date range one at a time; every post it handles
 * keeps a row saying what became of it.
 */

export const importSources = ['facebook_posts'] as const;
export const importSourceSchema = z.enum(importSources);
export type ImportSource = z.infer<typeof importSourceSchema>;

/**
 * `stopping` waits for the current post; `stopped` can be resumed. A shop has
 * at most one run that is `queued`, `running` or `stopping`.
 */
export const importRunStatuses = [
  'queued',
  'running',
  'stopping',
  'stopped',
  'finished',
  'failed',
] as const;
export const importRunStatusSchema = z.enum(importRunStatuses);
export type ImportRunStatus = z.infer<typeof importRunStatusSchema>;

/** The statuses a shop can have only one run in. */
export const ACTIVE_IMPORT_STATUSES = [
  'queued',
  'running',
  'stopping',
] as const satisfies readonly ImportRunStatus[];

/** What became of one post. */
export const importPostResults = [
  'draft',
  'merged',
  'not_product',
  'in_catalog',
  'already_imported',
  'failed',
] as const;
export const importPostResultSchema = z.enum(importPostResults);
export type ImportPostResult = z.infer<typeof importPostResultSchema>;

/** The summary's tabs. */
export const importPostFilters = ['needs_info', 'ready', 'skipped'] as const;
export const importPostFilterSchema = z.enum(importPostFilters);
export type ImportPostFilter = z.infer<typeof importPostFilterSchema>;

/** The most days one run reads, `since` and `until` included. */
export const IMPORT_RANGE_MAX_DAYS = 366;

/** Photos copied per post, the gallery's own cap. */
export const IMPORT_POST_PHOTO_MAX = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `yyyy-MM-dd`, a real calendar day. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), {
    params: { code: 'INVALID_FORMAT' },
  });

/** Days from `since` to `until`, both included. */
export function importRangeDays(since: string, until: string): number {
  return (
    Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / DAY_MS) + 1
  );
}

/**
 * POST /imports. Dates are in the shop's time zone. That `until` is not after
 * the shop's today is the API's check, since only it knows the zone.
 */
export const createImportSchema = z
  .object({
    source: importSourceSchema,
    since: calendarDate,
    until: calendarDate,
  })
  .strict()
  .superRefine(({ since, until }, ctx) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return;
    const days = importRangeDays(since, until);
    if (days < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['since'],
        message: 'Must not be after the end date',
        params: { code: 'INVALID_VALUE' },
      });
    } else if (days > IMPORT_RANGE_MAX_DAYS) {
      ctx.addIssue({
        code: 'too_big',
        origin: 'number',
        maximum: IMPORT_RANGE_MAX_DAYS,
        inclusive: true,
        path: ['since'],
        message: `At most ${IMPORT_RANGE_MAX_DAYS} days per import`,
        input: days,
      });
    }
  })
  .meta({ id: 'CreateImport' });
export type CreateImport = z.infer<typeof createImportSchema>;

const count = z.number().int().nonnegative();

export const importRunSchema = z
  .object({
    id: z.string().uuid(),
    source: importSourceSchema,
    since: z.string(),
    until: z.string(),
    status: importRunStatusSchema,
    /** Why a `failed` run failed; null otherwise. */
    errorCode: z.string().nullable(),
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    /** Null until the last page of posts is read. */
    postsTotal: count.nullable(),
    postsRead: count,
    drafts: count,
    merged: count,
    notProducts: count,
    inCatalog: count,
    alreadyImported: count,
    failed: count,
    /** This run's products still in draft. */
    leftToReview: count,
  })
  .meta({ id: 'ImportRun' });
export type ImportRun = z.infer<typeof importRunSchema>;

export const importRunListResponseSchema = z
  .object({ data: z.array(importRunSchema), total: count })
  .meta({ id: 'ImportRunListResponse' });
export type ImportRunListResponse = z.infer<typeof importRunListResponseSchema>;

export const IMPORT_LIST_PAGE_SIZES = [10, 25, 50] as const;

const pageSize = z.coerce
  .number()
  .int()
  .refine((n) => (IMPORT_LIST_PAGE_SIZES as readonly number[]).includes(n), {
    params: { code: 'INVALID_VALUE' },
  })
  .default(10);

export const listImportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: pageSize,
});
export type ListImportsQuery = z.infer<typeof listImportsQuerySchema>;

export const listImportPostsQuerySchema = z.object({
  result: importPostFilterSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: pageSize,
});
export type ListImportPostsQuery = z.infer<typeof listImportPostsQuerySchema>;

/** A draft as the summary lists it, with what it still needs before it can go live. */
export const importProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(['draft', 'active', 'archived']),
  coverThumbnailUrl: z.string().url().nullable(),
  variantCount: z.number().int().nonnegative(),
  needsPrice: z.boolean(),
  needsStock: z.boolean(),
});
export type ImportProduct = z.infer<typeof importProductSchema>;

export const importPostSchema = z
  .object({
    id: z.string().uuid(),
    /** Facebook's id, `<page id>_<post id>`. */
    postId: z.string(),
    createdTime: z.string().datetime().nullable(),
    caption: z.string().nullable(),
    url: z.string().url().nullable(),
    photoCount: z.number().int().nonnegative(),
    result: importPostResultSchema,
    /** Why it was skipped or failed, in the reader's words or as a code. */
    reason: z.string().nullable(),
    /** A category name the LLM suggested that the shop does not have. */
    suggestedCategory: z.string().nullable(),
    /** For `in_catalog`: the shop's products it matched. */
    matchedProducts: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
    /** The drafts it made or merged into that still exist. */
    products: z.array(importProductSchema),
  })
  .meta({ id: 'ImportPost' });
export type ImportPost = z.infer<typeof importPostSchema>;

export const importPostListResponseSchema = z
  .object({ data: z.array(importPostSchema), total: count })
  .meta({ id: 'ImportPostListResponse' });
export type ImportPostListResponse = z.infer<typeof importPostListResponseSchema>;

/** POST /imports/:id/activate. */
export const activateImportSchema = z
  .object({
    productIds: z.array(z.string().uuid()).min(1).max(100),
    /** Set on every live variant that has no stock yet. */
    startingStock: z.number().int().nonnegative().max(1_000_000),
  })
  .strict()
  .meta({ id: 'ActivateImport' });
export type ActivateImport = z.infer<typeof activateImportSchema>;

export const activateImportResultSchema = z
  .object({
    activated: z.array(z.string().uuid()),
    failed: z.array(
      z.object({
        productId: z.string().uuid(),
        code: z.enum(['PRODUCT_NOT_FOUND', 'PRODUCT_NOT_DRAFT', 'PRODUCT_PRICE_MISSING']),
      }),
    ),
  })
  .meta({ id: 'ActivateImportResult' });
export type ActivateImportResult = z.infer<typeof activateImportResultSchema>;

/** GET /imports/facebook/access: whether a run could start now. */
export const facebookImportAccessSchema = z
  .object({
    pageConnected: z.boolean(),
    canReadPosts: z.boolean(),
  })
  .meta({ id: 'FacebookImportAccess' });
export type FacebookImportAccess = z.infer<typeof facebookImportAccessSchema>;
