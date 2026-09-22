import { z } from 'zod';

export const stockStatusSchema = z.enum(['in_stock', 'out_of_stock']);
export type StockStatus = z.infer<typeof stockStatusSchema>;

export const variantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  /** Minor units. */
  price: z.number().int().nonnegative(),
  stockStatus: stockStatusSchema,
});

export const productSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  images: z.array(z.string().url()).default([]),
  /** Minor units. */
  deliveryCharge: z.number().int().nonnegative(),
  variants: z.array(variantSchema),
});
export type Product = z.infer<typeof productSchema>;

export const createProductSchema = productSchema.omit({ id: true }).extend({
  variants: z.array(variantSchema.omit({ id: true })).min(1),
});
export type CreateProduct = z.infer<typeof createProductSchema>;

export const productCsvRowSchema = z.object({
  name: z.string().min(1),
  aliases: z.string().optional(),
  variant: z.string().min(1),
  price: z.string().min(1),
  stock: z.string().optional(),
  delivery_charge: z.string().optional(),
  image_url: z.string().optional(),
});
