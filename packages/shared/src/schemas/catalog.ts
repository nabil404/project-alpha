import { z } from 'zod';

export const stockStatusSchema = z.enum(['in_stock', 'out_of_stock']);
export type StockStatus = z.infer<typeof stockStatusSchema>;

/** `draft` is being set up, `active` is what the AI may offer, `archived` is retired. */
export const productStatusSchema = z.enum(['draft', 'active', 'archived']);
export type ProductStatus = z.infer<typeof productStatusSchema>;

/** Upload limits. The API enforces them; the dashboard pre-checks against the same values. */
export const PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_COUNT = 8;
/** What the file picker offers; the API decides by the file's content, not this type. */
export const PRODUCT_IMAGE_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** A product varies on at most this many options; each has at most this many values. */
export const PRODUCT_OPTION_MAX_COUNT = 3;
export const PRODUCT_OPTION_VALUE_MAX_COUNT = 30;
/** Live variants per product. Options multiply; this caps what one save can create. */
export const PRODUCT_VARIANT_MAX_COUNT = 100;

/** A stored product image as the API returns it. URLs are public; `position` is gallery order only. */
export const productImageSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  thumbnailUrl: z.string().url(),
  position: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ProductImage = z.infer<typeof productImageSchema>;

/** The product's current image ids, every one exactly once, in the new gallery order. */
export const reorderProductImagesSchema = z.object({
  imageIds: z.array(z.string().uuid()).min(1).max(PRODUCT_IMAGE_MAX_COUNT),
});
export type ReorderProductImages = z.infer<typeof reorderProductImagesSchema>;

const categoryNameSchema = z.string().trim().min(1).max(80);

export const categorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
});
export type Category = z.infer<typeof categorySchema>;

/**
 * A category as the category routes return it, for the Categories page.
 * `productCount` counts every product linked to it, whatever the status, so it
 * is the number a delete takes the category off.
 */
export const categoryWithCountSchema = categorySchema.extend({
  productCount: z.number().int().nonnegative(),
});
export type CategoryWithCount = z.infer<typeof categoryWithCountSchema>;

export const createCategorySchema = z.object({
  name: categoryNameSchema,
});
export type CreateCategory = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z.object({
  name: categoryNameSchema,
});
export type UpdateCategory = z.infer<typeof updateCategorySchema>;

export const productOptionValueSchema = z.object({
  id: z.string().uuid(),
  value: z.string().min(1),
});
export type ProductOptionValue = z.infer<typeof productOptionValueSchema>;

/** A dimension the product varies on ("Size"), its values in the order customers see them. */
export const productOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  values: z.array(productOptionValueSchema),
});
export type ProductOption = z.infer<typeof productOptionSchema>;

export const variantSchema = z.object({
  id: z.string().uuid(),
  /**
   * Null only for the default variant. Otherwise the name the seller gave it,
   * or its option values joined ("M / Short") when they gave none.
   */
  name: z.string().min(1).nullable(),
  sku: z.string().min(1),
  /** Minor units. */
  price: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative(),
  /** Derived from `stock`; never written. */
  stockStatus: stockStatusSchema,
  isDefault: z.boolean(),
  /** One of the product's own images, or null for the product's cover. */
  imageId: z.string().uuid().nullable().default(null),
  /** One value id per product option, in the options' order; empty for the default variant. */
  optionValueIds: z.array(z.string().uuid()).default([]),
});
export type Variant = z.infer<typeof variantSchema>;

export const productSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  status: productStatusSchema,
  aliases: z.array(z.string().min(1)).default([]),
  categoryIds: z.array(z.string().uuid()).default([]),
  images: z.array(productImageSchema).default([]),
  /** The default photo; null exactly when there are no images. */
  coverImageId: z.string().uuid().nullable().default(null),
  options: z.array(productOptionSchema).default([]),
  /** Minor units. */
  deliveryCharge: z.number().int().nonnegative(),
  variants: z.array(variantSchema),
  /** Opaque. Send it back with a save; a save from an older read is refused with PRODUCT_STALE. */
  version: z.string().min(1),
});
export type Product = z.infer<typeof productSchema>;

const productNameSchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().trim().max(5000).nullable();
/** Blank or omitted: the API generates one. */
const skuInputSchema = z.string().trim().max(64).optional();
const moneySchema = z.number().int().nonnegative();
const stockSchema = z.number().int().nonnegative();

/** `categoryIds`, when present, replaces the product's links. */
export const updateProductSchema = z.object({
  name: productNameSchema.optional(),
  description: descriptionSchema.optional(),
  status: productStatusSchema.optional(),
  aliases: z.array(z.string().trim().min(1)).optional(),
  deliveryCharge: moneySchema.optional(),
  categoryIds: z.array(z.string().uuid()).optional(),
});
export type UpdateProduct = z.infer<typeof updateProductSchema>;

/**
 * One variant's own fields, outside the edit page's document save: a quick
 * stock or price change. Its option values change only through that save.
 */
export const updateVariantSchema = z.object({
  sku: z.string().trim().min(1).max(64).optional(),
  price: moneySchema.optional(),
  stock: stockSchema.optional(),
  /** One of the product's own images; null shows the product's cover. */
  imageId: z.string().uuid().nullable().optional(),
});
export type UpdateVariant = z.infer<typeof updateVariantSchema>;

const optionNameSchema = z.string().trim().min(1).max(40);
const optionValueTextSchema = z.string().trim().min(1).max(40);

/** `id` keeps (and may rename) an existing option or value; omit it to create one. */
export const productOptionInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: optionNameSchema,
  values: z
    .array(z.object({ id: z.string().uuid().optional(), value: optionValueTextSchema }))
    .min(1)
    .max(PRODUCT_OPTION_VALUE_MAX_COUNT),
});
export type ProductOptionInput = z.infer<typeof productOptionInputSchema>;

/** Room for three 40-character values joined with " / ". */
export const VARIANT_NAME_MAX_LENGTH = 128;

/**
 * `optionValues` picks one value per option by its text, in the options'
 * order, so a variant can point at a value created in the same save. It is
 * empty exactly when the product has no options. `id` keeps an existing
 * variant; omit it to add one. `name` is what customers and the assistant call
 * it; blank or absent, it is the values joined, and the default variant of a
 * product without options stays unnamed whatever it says.
 */
export const productVariantInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().max(VARIANT_NAME_MAX_LENGTH).optional(),
  optionValues: z.array(optionValueTextSchema).max(PRODUCT_OPTION_MAX_COUNT).default([]),
  sku: skuInputSchema,
  price: moneySchema,
  stock: stockSchema.default(0),
  /** One of the product's own images; null shows the product's cover. */
  imageId: z.string().uuid().nullable().default(null),
});
export type ProductVariantInput = z.infer<typeof productVariantInputSchema>;

/** Values compare trimmed and case-insensitively, as a customer would read them. */
const sameText = (text: string) => text.trim().toLowerCase();

type DocumentIssueCode =
  'DUPLICATE' | 'UNKNOWN_OPTION_VALUE' | 'OPTION_VALUES_MISMATCH' | 'VARIANTS_NEED_OPTION';

/**
 * The rules a product document must satisfy beyond its field types. Shared,
 * so the edit page's form reports the same field codes the API would. The API
 * runs it again for callers that skip the schema, and the product row lock
 * serializes writers, which is why the database carries no uniqueness index
 * for these.
 */
export function refineProductDocument(
  doc: { options: ProductOptionInput[]; variants: ProductVariantInput[] },
  ctx: z.RefinementCtx,
): void {
  const issue = (path: (string | number)[], code: DocumentIssueCode, message: string) =>
    ctx.addIssue({ code: 'custom', path, message, params: { code } });

  const unique = <T>(
    items: T[],
    key: (item: T) => string | undefined,
    path: (index: number) => (string | number)[],
    message: string,
  ) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const k = key(item);
      if (k === undefined) return;
      if (seen.has(k)) issue(path(index), 'DUPLICATE', message);
      seen.add(k);
    });
  };

  unique(
    doc.options,
    (o) => sameText(o.name),
    (i) => ['options', i, 'name'],
    'Two options share this name',
  );
  unique(
    doc.options,
    (o) => o.id,
    (i) => ['options', i, 'id'],
    'Option listed twice',
  );
  doc.options.forEach((option, i) => {
    unique(
      option.values,
      (v) => sameText(v.value),
      (j) => ['options', i, 'values', j, 'value'],
      'This option already has this value',
    );
    unique(
      option.values,
      (v) => v.id,
      (j) => ['options', i, 'values', j, 'id'],
      'Value listed twice',
    );
  });

  if (doc.options.length === 0 && doc.variants.length > 1) {
    issue(['variants'], 'VARIANTS_NEED_OPTION', 'A product without options is sold as one variant');
  }

  doc.variants.forEach((variant, k) => {
    if (variant.optionValues.length !== doc.options.length) {
      issue(['variants', k, 'optionValues'], 'OPTION_VALUES_MISMATCH', 'Pick one value per option');
      return;
    }
    variant.optionValues.forEach((text, i) => {
      if (!doc.options[i]!.values.some((v) => sameText(v.value) === sameText(text))) {
        issue(
          ['variants', k, 'optionValues', i],
          'UNKNOWN_OPTION_VALUE',
          'Not a value of this option',
        );
      }
    });
  });

  if (doc.options.length > 0) {
    unique(
      doc.variants,
      (v) => v.optionValues.map(sameText).join('\u0000'),
      (k) => ['variants', k, 'optionValues'],
      'Another variant has the same values',
    );
    // Unnamed variants that clash already share their values, reported above.
    const names = new Map<string, boolean>();
    doc.variants.forEach((v, k) => {
      const named = Boolean(v.name);
      const key = sameText(v.name || v.optionValues.join(' / '));
      const earlier = names.get(key);
      if (earlier !== undefined && (named || earlier)) {
        issue(['variants', k, 'name'], 'DUPLICATE', 'Another variant has this name');
      }
      if (!earlier) names.set(key, named);
    });
  }
  unique(
    doc.variants,
    (v) => v.id,
    (k) => ['variants', k, 'id'],
    'Variant listed twice',
  );
  unique(
    doc.variants,
    (v) => v.sku?.trim().toUpperCase() || undefined,
    (k) => ['variants', k, 'sku'],
    'Another variant of this product uses this SKU',
  );
}

const productDocumentShape = {
  name: productNameSchema,
  description: descriptionSchema.default(null),
  status: productStatusSchema.default('draft'),
  aliases: z.array(z.string().trim().min(1)).default([]),
  deliveryCharge: moneySchema,
  categoryIds: z.array(z.string().uuid()).default([]),
  options: z.array(productOptionInputSchema).max(PRODUCT_OPTION_MAX_COUNT).default([]),
  variants: z.array(productVariantInputSchema).min(1).max(PRODUCT_VARIANT_MAX_COUNT),
};

/**
 * The edit page's whole document, saved at once. Options, values and variants
 * left out are removed (variants archived). `version` is the product's
 * `version` as the page read it; a save from an older read is refused.
 */
export const saveProductSchema = z
  .object({
    ...productDocumentShape,
    version: z.string().min(1),
    /** Null picks the first photo, so a product with photos always has a cover. */
    coverImageId: z.string().uuid().nullable().default(null),
  })
  .superRefine(refineProductDocument);
export type SaveProduct = z.infer<typeof saveProductSchema>;

/** Images attach through their own endpoint afterwards, so creation carries none. */
export const createProductSchema = z
  .object(productDocumentShape)
  .superRefine(refineProductDocument);
export type CreateProduct = z.infer<typeof createProductSchema>;

/** CSV import carries no images or categories; sellers add those in the dashboard afterwards. */
export const productCsvRowSchema = z.object({
  name: z.string().min(1),
  aliases: z.string().optional(),
  variant: z.string().min(1),
  sku: z.string().optional(),
  price: z.string().min(1),
  /** A count, not a status. */
  stock: z.string().optional(),
  delivery_charge: z.string().optional(),
});

/**
 * A variant at or below this many is running low. Fixed for every seller until
 * the threshold becomes a setting; the Products page and its counts read it.
 */
export const LOW_STOCK_THRESHOLD = 5;

/** The Products page's stock reading, finer than a variant's `stockStatus`. */
export const stockLevels = ['in_stock', 'low_stock', 'out_of_stock'] as const;
export const stockLevelSchema = z.enum(stockLevels);
export type StockLevel = z.infer<typeof stockLevelSchema>;

export function stockLevelOf(stock: number): StockLevel {
  if (stock <= 0) return 'out_of_stock';
  return stock <= LOW_STOCK_THRESHOLD ? 'low_stock' : 'in_stock';
}

/**
 * The Products page's filter chips. `all` and the stock filters leave archived
 * products out; `archived` is the only way to list them. A product is out of
 * stock when none of its variants is left, and low when any is low or out.
 */
export const productListFilters = [
  'all',
  'in_stock',
  'low_stock',
  'out_of_stock',
  'draft',
  'archived',
] as const;
export const productListFilterSchema = z.enum(productListFilters);
export type ProductListFilter = z.infer<typeof productListFilterSchema>;

export const PRODUCT_LIST_PAGE_SIZES = [10, 25, 50, 100] as const;

/** An empty `q=` in the URL means no search, not a failed one. */
const productSearchTerm = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().max(100).optional(),
);

/**
 * GET /products, newest first. `q` matches the name, a tag or a live
 * variant's SKU; `categoryId` keeps products in that category.
 */
export const listProductsQuerySchema = z.object({
  filter: productListFilterSchema.default('all'),
  q: productSearchTerm,
  categoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .refine((n) => (PRODUCT_LIST_PAGE_SIZES as readonly number[]).includes(n), {
      message: `One of ${PRODUCT_LIST_PAGE_SIZES.join(', ')}`,
    })
    .default(10),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

/** A product's only variant, in its list row, so the row needs no second read. */
export const productListVariantSchema = z.object({
  id: z.string().uuid(),
  /** Null for the default variant of a product without options. */
  name: z.string().min(1).nullable(),
  sku: z.string().min(1),
  /** Minor units. */
  price: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative(),
  stockLevel: stockLevelSchema,
  /** Its own image, else the product's cover; null when the product has no photos. */
  thumbnailUrl: z.string().url().nullable(),
});
export type ProductListVariant = z.infer<typeof productListVariantSchema>;

/**
 * One row of the Products page: the product and its live variants summed up.
 * The variants themselves load on demand through GET /products/:id, except a
 * lone one, which comes inline as `variant`.
 */
export const productListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: productStatusSchema,
  /** Live categories, by name. */
  categoryIds: z.array(z.string().uuid()),
  coverThumbnailUrl: z.string().url().nullable(),
  /** Option names in order ("Size", "Colour"); empty for a product without options. */
  optionNames: z.array(z.string().min(1)),
  variantCount: z.number().int().positive(),
  /** Minor units, over live variants. */
  priceMin: z.number().int().nonnegative(),
  priceMax: z.number().int().nonnegative(),
  /** Units left across live variants. */
  stock: z.number().int().nonnegative(),
  lowVariantCount: z.number().int().nonnegative(),
  outVariantCount: z.number().int().nonnegative(),
  stockLevel: stockLevelSchema,
  /** Present exactly when `variantCount` is 1. */
  variant: productListVariantSchema.nullable(),
});
export type ProductListItem = z.infer<typeof productListItemSchema>;

export const productListResponseSchema = z.object({
  data: z.array(productListItemSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});
export type ProductListResponse = z.infer<typeof productListResponseSchema>;

/** GET /products/counts: the filter chips and the stock banner. Ignores search and category. */
export const productCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  inStock: z.number().int().nonnegative(),
  lowStock: z.number().int().nonnegative(),
  outOfStock: z.number().int().nonnegative(),
  draft: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
});
export type ProductCounts = z.infer<typeof productCountsSchema>;
