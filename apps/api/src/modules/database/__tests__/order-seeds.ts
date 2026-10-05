import type { Database } from '../database.module';
import { orderReference } from '../../orders/order-reference';
import * as schema from '../schema/index';

let nextNumber = 1;

export interface SeedItem {
  productName?: string;
  variantName?: string | null;
  quantity?: number;
  unitPrice?: number;
}

/**
 * An order with its items; totals follow from them. Bypasses everything the
 * orders work will enforce on creation - it is a fixture for the read side.
 */
export async function seedOrder(
  db: Database,
  merchantId: string,
  customerId: string,
  {
    items = [{}],
    deliveryFee = 0,
    ...overrides
  }: Partial<typeof schema.order.$inferInsert> & { items?: SeedItem[] } = {},
) {
  const lines = items.map((item, position) => ({
    productName: item.productName ?? 'Blue kurti',
    variantName: item.variantName === undefined ? 'M' : item.variantName,
    quantity: item.quantity ?? 1,
    unitPrice: item.unitPrice ?? 100000,
    position,
  }));
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const number = overrides.number ?? nextNumber++;
  const year = overrides.year ?? 2026;
  const [row] = await db
    .insert(schema.order)
    .values({
      merchantId,
      customerId,
      number,
      year,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      currency: 'BDT',
      customerName: 'Nusrat Jahan',
      phone: '01712-345678',
      deliveryAddress: 'House 12, Road 4, Mirpur 10, Dhaka',
      placedAt: new Date(),
      ...overrides,
      reference: overrides.reference ?? orderReference(year, number),
    })
    .returning();
  if (!row) throw new Error('seedOrder returned no row');
  if (lines.length > 0) {
    await db
      .insert(schema.orderItem)
      .values(lines.map((line) => ({ merchantId, orderId: row.id, ...line })));
  }
  return row;
}
