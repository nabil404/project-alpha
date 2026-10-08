import { z } from 'zod';
import { ORDER_MAX_ITEMS } from './order';

/**
 * Settings > Delivery charges: what delivery costs and how long it takes to
 * each area the shop names, plus "everywhere else" for an address that
 * matches none. Area names are free text, written the way customers write
 * them. A product can set its own charge per area (catalog.ts).
 */

export const DELIVERY_AREAS_MAX = 100;
export const DELIVERY_AREA_NAME_MAX_LENGTH = 100;
export const DELIVERY_TIME_MAX_LENGTH = 40;

const money = z.number().int().nonnegative();

/** An area name as stored and shown: trimmed, inner whitespace collapsed, case kept. */
export function normalizeAreaName(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** What two names are compared by: "Dhaka" and " dhaka " are the same area. */
export function areaKey(text: string): string {
  return normalizeAreaName(text).toLocaleLowerCase('en');
}

/** A blank delivery time clears it. */
const deliveryTimeInput = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().max(DELIVERY_TIME_MAX_LENGTH).nullable(),
);

const areaNameInput = z
  .string()
  .transform(normalizeAreaName)
  .pipe(
    z
      .string()
      .min(1)
      .max(DELIVERY_AREA_NAME_MAX_LENGTH)
      // No control characters: a settings save parks names behind one while it renames.
      .refine((name) => !/\p{Cc}/u.test(name), { params: { code: 'INVALID_INPUT' } }),
  );

export const deliveryAreaChargeSchema = z.object({
  id: z.string().uuid(),
  areaName: z.string(),
  /** Minor units of the shop's currency. */
  charge: money,
  /** What the assistant tells customers, e.g. "1–2 days". */
  deliveryTime: z.string().nullable(),
});
export type DeliveryAreaCharge = z.infer<typeof deliveryAreaChargeSchema>;

export const everywhereElseSchema = deliveryAreaChargeSchema.omit({ areaName: true });
export type EverywhereElse = z.infer<typeof everywhereElseSchema>;

/** GET and PUT /settings/delivery. */
export const deliverySettingsSchema = z.object({
  /** ISO 4217: every charge and the threshold are in it. */
  currency: z.string(),
  /** The named areas, in the order the seller listed them. */
  deliveryCharges: z.array(deliveryAreaChargeSchema),
  /** For an address that matches no area. Null until the shop first saves. */
  everywhereElse: everywhereElseSchema.nullable(),
  /** Orders with a subtotal at or over this ship free; null always charges. */
  freeDeliveryOver: money.nullable(),
});
export type DeliverySettings = z.infer<typeof deliverySettingsSchema>;

/**
 * PUT /settings/delivery: the whole page. A row with an id is updated, one
 * without is added, and a named row left out is removed - with its product
 * overrides; orders delivered there keep its name and estimate.
 */
export const saveDeliverySettingsSchema = z
  .object({
    deliveryCharges: z
      .array(
        z
          .object({
            id: z.string().uuid().optional(),
            areaName: areaNameInput,
            charge: money,
            deliveryTime: deliveryTimeInput.default(null),
          })
          .strict(),
      )
      .max(DELIVERY_AREAS_MAX)
      .superRefine((rows, ctx) => {
        const seen = new Set<string>();
        rows.forEach((row, index) => {
          const key = areaKey(row.areaName);
          if (seen.has(key)) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'areaName'],
              message: 'Another area has this name',
              params: { code: 'DUPLICATE' },
            });
          }
          seen.add(key);
        });
      }),
    everywhereElse: z
      .object({ charge: money, deliveryTime: deliveryTimeInput.default(null) })
      .strict(),
    freeDeliveryOver: money.nullable(),
  })
  .strict();
export type SaveDeliverySettings = z.infer<typeof saveDeliverySettingsSchema>;
export type SaveDeliverySettingsInput = z.input<typeof saveDeliverySettingsSchema>;

/**
 * The delivery fee for an order to one area (or everywhere else). Each
 * product costs its own charge for the area if it sets one (`productCharges`,
 * one entry per product, null for "use the shop charge"), else the shop's;
 * the order pays the highest, not the sum, and nothing once the subtotal
 * reaches the shop's threshold. The dashboard's prefill and the assistant's
 * quote both come from here.
 */
export function deliveryFeeFor({
  shopCharge,
  productCharges,
  subtotal,
  freeDeliveryOver,
}: {
  shopCharge: number;
  productCharges: readonly (number | null)[];
  subtotal: number;
  freeDeliveryOver: number | null;
}): number {
  if (freeDeliveryOver !== null && subtotal >= freeDeliveryOver) return 0;
  if (productCharges.length === 0) return shopCharge;
  return Math.max(...productCharges.map((charge) => charge ?? shopCharge));
}

/** POST /orders/delivery-quote: what delivering these items to that area costs. */
export const deliveryQuoteRequestSchema = z
  .object({
    deliveryChargeId: z.string().uuid(),
    items: z
      .array(
        z
          .object({
            variantId: z.string().uuid(),
            quantity: z.number().int().positive().max(9999),
            unitPrice: money.optional(),
          })
          .strict(),
      )
      .max(ORDER_MAX_ITEMS),
  })
  .strict();
export type DeliveryQuoteRequest = z.infer<typeof deliveryQuoteRequestSchema>;

export const deliveryQuoteSchema = z.object({
  fee: money,
  /** The subtotal the threshold was checked against. */
  subtotal: money,
  /** True when the threshold made it free. */
  freeDeliveryApplied: z.boolean(),
});
export type DeliveryQuote = z.infer<typeof deliveryQuoteSchema>;
