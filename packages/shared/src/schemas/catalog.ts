import { z } from 'zod';

export const stockStatusSchema = z.enum(['in_stock', 'out_of_stock']);
export type StockStatus = z.infer<typeof stockStatusSchema>;

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

export const variantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  /** Minor units. */
  price: z.number().int().nonnegative(),
  stockStatus: stockStatusSchema,
  /** One of the product's own images, or null for the product's cover. */
  imageId: z.string().uuid().nullable().default(null),
});

export const productSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  images: z.array(productImageSchema).default([]),
  /** Minor units. */
  deliveryCharge: z.number().int().nonnegative(),
  variants: z.array(variantSchema),
});
export type Product = z.infer<typeof productSchema>;

/** Images attach to an existing product through their own endpoint, so creation carries none. */
export const createProductSchema = productSchema.omit({ id: true, images: true }).extend({
  variants: z.array(variantSchema.omit({ id: true, imageId: true })).min(1),
});
export type CreateProduct = z.infer<typeof createProductSchema>;

/** CSV import carries no images; sellers attach photos in the dashboard afterwards. */
export const productCsvRowSchema = z.object({
  name: z.string().min(1),
  aliases: z.string().optional(),
  variant: z.string().min(1),
  price: z.string().min(1),
  stock: z.string().optional(),
  delivery_charge: z.string().optional(),
});
