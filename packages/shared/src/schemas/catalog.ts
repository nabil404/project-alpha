import { z } from 'zod';

export const stockStatusSchema = z.enum(['in_stock', 'out_of_stock']);
export type StockStatus = z.infer<typeof stockStatusSchema>;

/** `draft` is being set up, `active` is what the AI may offer, `archived` is retired. */
export const productStatusSchema = z.enum(['draft', 'active', 'archived']);
export type ProductStatus = z.infer<typeof productStatusSchema>;

/** Categories nest at most this many levels, roots included. */
export const CATEGORY_MAX_DEPTH = 3;

/** Upload limits. The API enforces them; the dashboard pre-checks against the same values. */
export const PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_COUNT = 8;

/** A stored product image as the API returns it. URLs are public; `position` 0 is the cover. */
export const productImageSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  thumbnailUrl: z.string().url(),
  position: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ProductImage = z.infer<typeof productImageSchema>;

/** The product's current image ids, every one exactly once, in the new order. */
export const reorderProductImagesSchema = z.object({
  imageIds: z.array(z.string().uuid()).min(1).max(PRODUCT_IMAGE_MAX_COUNT),
});
export type ReorderProductImages = z.infer<typeof reorderProductImagesSchema>;

const categoryNameSchema = z.string().trim().min(1).max(80);

export const categorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  parentId: z.string().uuid().nullable(),
});
export type Category = z.infer<typeof categorySchema>;

export const createCategorySchema = z.object({
  name: categoryNameSchema,
  parentId: z.string().uuid().nullable().default(null),
});
export type CreateCategory = z.infer<typeof createCategorySchema>;

/** `parentId: null` moves the category to the root; omitting it leaves it where it is. */
export const updateCategorySchema = z.object({
  name: categoryNameSchema.optional(),
  parentId: z.string().uuid().nullable().optional(),
});
export type UpdateCategory = z.infer<typeof updateCategorySchema>;

export const variantSchema = z.object({
  id: z.string().uuid(),
  /** Null only for the default variant - the one a product without options is sold as. */
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
  /** Minor units. */
  deliveryCharge: z.number().int().nonnegative(),
  variants: z.array(variantSchema),
});
export type Product = z.infer<typeof productSchema>;

const productNameSchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().trim().max(5000).nullable();
const variantNameSchema = z.string().trim().min(1).max(80);
/** Blank or omitted: the API generates one. */
const skuInputSchema = z.string().trim().max(64).optional();
const moneySchema = z.number().int().nonnegative();
const stockSchema = z.number().int().nonnegative();

const newVariantSchema = z.object({
  name: variantNameSchema.nullable().default(null),
  sku: skuInputSchema,
  price: moneySchema,
  stock: stockSchema.default(0),
});

/** Images attach through their own endpoint afterwards, so creation carries none. */
export const createProductSchema = z
  .object({
    name: productNameSchema,
    description: descriptionSchema.default(null),
    status: productStatusSchema.default('draft'),
    aliases: z.array(z.string().trim().min(1)).default([]),
    deliveryCharge: moneySchema,
    categoryIds: z.array(z.string().uuid()).default([]),
    variants: z.array(newVariantSchema).min(1),
  })
  .refine((p) => p.variants.length === 1 || p.variants.every((v) => v.name !== null), {
    path: ['variants'],
    message: 'Every variant needs a name when there is more than one',
  });
export type CreateProduct = z.infer<typeof createProductSchema>;

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

/** `defaultVariantName` names the product's default variant; required when it has one. */
export const addVariantSchema = z.object({
  name: variantNameSchema,
  sku: skuInputSchema,
  price: moneySchema,
  stock: stockSchema.default(0),
  defaultVariantName: variantNameSchema.optional(),
});
export type AddVariant = z.infer<typeof addVariantSchema>;

/** `name: null` is allowed only on a product's single live variant, which makes it the default. */
export const updateVariantSchema = z.object({
  name: variantNameSchema.nullable().optional(),
  sku: z.string().trim().min(1).max(64).optional(),
  price: moneySchema.optional(),
  stock: stockSchema.optional(),
  /** One of the product's own images; null shows the product's cover. */
  imageId: z.string().uuid().nullable().optional(),
});
export type UpdateVariant = z.infer<typeof updateVariantSchema>;

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
