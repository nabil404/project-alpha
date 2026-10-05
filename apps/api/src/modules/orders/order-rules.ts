import {
  orderHoldsStock,
  type OrderDeliveryField,
  type OrderEventData,
  type OrderItemInput,
  type OrderStatus,
  type UpdateOrder,
} from '@app/shared';
import type { OrderItemRow, OrderRow } from '../database/schema/index';
import { variantNotFound } from '../products/product-errors';
import type { OrderableVariant } from './order-catalog.repository';
import type { NewOrderLine, OrderChanges } from './orders.repository';

/** What the stock rules need of a line. Lines from before catalog links have no variant and move no stock. */
export interface StockLine {
  variantId?: string | null;
  productId?: string | null;
  quantity: number;
}

export interface StockChange {
  variantId: string;
  productId: string;
  /** Added to the variant's stock: negative takes, positive gives back. */
  change: number;
}

function held(lines: readonly StockLine[], status: OrderStatus): Map<string, StockLine> {
  const byVariant = new Map<string, StockLine>();
  if (!orderHoldsStock(status)) return byVariant;
  for (const line of lines) {
    if (!line.variantId || !line.productId) continue;
    const seen = byVariant.get(line.variantId);
    byVariant.set(line.variantId, { ...line, quantity: (seen?.quantity ?? 0) + line.quantity });
  }
  return byVariant;
}

/**
 * The stock moves that take an order from `before` to `after`: a status
 * change, an item edit, or both. Whatever the order held before is given back
 * and whatever it holds after is taken, netted per variant, so an edit that
 * only changes a quantity moves only the difference. Sorted by variant id, so
 * concurrent writers update rows in the same order. Zero changes are left out.
 */
export function stockChanges(
  before: { lines: readonly StockLine[]; status: OrderStatus },
  after: { lines: readonly StockLine[]; status: OrderStatus },
): StockChange[] {
  const was = held(before.lines, before.status);
  const now = held(after.lines, after.status);
  const changes: StockChange[] = [];
  for (const variantId of new Set([...was.keys(), ...now.keys()])) {
    const line = (now.get(variantId) ?? was.get(variantId)) as StockLine;
    const change = (was.get(variantId)?.quantity ?? 0) - (now.get(variantId)?.quantity ?? 0);
    if (change !== 0) changes.push({ variantId, productId: line.productId as string, change });
  }
  return changes.sort((a, b) => a.variantId.localeCompare(b.variantId));
}

/**
 * The order's new lines from the seller's list. A variant already on the
 * order keeps its snapshot (name, SKU and price as ordered), so an edit that
 * only changes a quantity never reprices or renames a line, and may keep a
 * variant that has since been archived. A variant new to the order must be
 * live, and is snapshotted from the catalog now.
 */
export function buildLines(
  input: readonly OrderItemInput[],
  current: readonly OrderItemRow[],
  variants: ReadonlyMap<string, OrderableVariant>,
): NewOrderLine[] {
  const existing = new Map(
    current.filter((line) => line.variantId).map((line) => [line.variantId as string, line]),
  );
  return input.map(({ variantId, quantity, unitPrice }) => {
    const kept = existing.get(variantId);
    if (kept) {
      return {
        productId: kept.productId,
        variantId,
        productName: kept.productName,
        variantName: kept.variantName,
        sku: kept.sku,
        quantity,
        unitPrice: unitPrice ?? kept.unitPrice,
      };
    }
    const variant = variants.get(variantId);
    if (!variant?.live) throw variantNotFound(variantId);
    return {
      productId: variant.productId,
      variantId,
      productName: variant.productName,
      variantName: variant.variantName,
      sku: variant.sku,
      quantity,
      unitPrice: unitPrice ?? variant.price,
    };
  });
}

export function subtotalOf(lines: readonly Pick<NewOrderLine, 'quantity' | 'unitPrice'>[]): number {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
}

/** A variant's name as the seller reads it: "Blue kurti, M", or the product alone for a default variant. */
export function variantLabel(
  variant: Pick<OrderableVariant, 'productName' | 'variantName'>,
): string {
  return variant.variantName
    ? `${variant.productName}, ${variant.variantName}`
    : variant.productName;
}

export interface OrderPatch {
  changes: OrderChanges;
  events: OrderEventData[];
  /** Whether a delivery field changes; those are refused once the order ships. */
  touchesDelivery: boolean;
}

/**
 * The column changes and activity a PATCH makes, comparing against the order
 * as it is so a field sent back unchanged is no change at all.
 */
export function planOrderPatch(row: OrderRow, input: Omit<UpdateOrder, 'version'>): OrderPatch {
  const changes: OrderChanges = {};
  const events: OrderEventData[] = [];

  const delivery: OrderDeliveryField[] = [];
  const set = <K extends keyof OrderChanges>(
    key: K,
    value: OrderChanges[K] | undefined,
    field?: OrderDeliveryField,
  ) => {
    if (value === undefined || value === row[key]) return;
    changes[key] = value;
    if (field) delivery.push(field);
  };
  set('customerName', input.customerName, 'name');
  set('phone', input.phone, 'phone');
  set('deliveryAddress', input.deliveryAddress, 'address');
  set('deliveryZone', input.deliveryZone, 'zone');
  set('deliveryCharge', input.deliveryCharge, 'charge');
  if (changes.deliveryCharge !== undefined) changes.total = row.subtotal + changes.deliveryCharge;
  if (delivery.length > 0) events.push({ type: 'delivery_changed', fields: delivery });

  set('paymentStatus', input.paymentStatus);
  set('paymentMethod', input.paymentMethod);
  if (changes.paymentStatus || changes.paymentMethod) {
    events.push({
      type: 'payment_changed',
      ...(changes.paymentStatus && {
        status: { from: row.paymentStatus, to: changes.paymentStatus },
      }),
      ...(changes.paymentMethod && {
        method: { from: row.paymentMethod, to: changes.paymentMethod },
      }),
    });
  }

  set('trackingNumber', input.trackingNumber);
  if (changes.trackingNumber !== undefined) {
    events.push({ type: 'tracking_changed', trackingNumber: changes.trackingNumber });
  }

  set('notes', input.note);

  return { changes, events, touchesDelivery: delivery.length > 0 };
}
