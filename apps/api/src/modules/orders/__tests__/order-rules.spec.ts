import { HttpException } from '@nestjs/common';
import { orderEventDataSchema } from '@app/shared';
import type { OrderItemRow, OrderRow } from '../../database/schema/index';
import type { OrderableVariant } from '../order-catalog.repository';
import { buildLines, planOrderPatch, stockChanges, subtotalOf } from '../order-rules';

const line = (variantId: string | null, quantity: number, productId: string | null = 'p1') => ({
  variantId,
  productId: variantId ? productId : null,
  quantity,
});

describe('stockChanges', () => {
  const lines = [line('v1', 2), line('v2', 1, 'p2')];

  it('takes the stock when an order is confirmed', () => {
    expect(stockChanges({ lines, status: 'new' }, { lines, status: 'confirmed' })).toEqual([
      { variantId: 'v1', productId: 'p1', change: -2 },
      { variantId: 'v2', productId: 'p2', change: -1 },
    ]);
  });

  it('moves nothing between two statuses that both hold stock, or neither', () => {
    expect(stockChanges({ lines, status: 'confirmed' }, { lines, status: 'packed' })).toEqual([]);
    expect(stockChanges({ lines, status: 'shipped' }, { lines, status: 'delivered' })).toEqual([]);
    expect(stockChanges({ lines, status: 'new' }, { lines, status: 'cancelled' })).toEqual([]);
  });

  it('gives the stock back on a cancel after confirming, and on a return', () => {
    const back = [
      { variantId: 'v1', productId: 'p1', change: 2 },
      { variantId: 'v2', productId: 'p2', change: 1 },
    ];
    expect(stockChanges({ lines, status: 'packed' }, { lines, status: 'cancelled' })).toEqual(back);
    expect(stockChanges({ lines, status: 'delivered' }, { lines, status: 'returned' })).toEqual(
      back,
    );
  });

  it('moves only the difference when a confirmed order’s items change', () => {
    const after = [line('v1', 3), line('v3', 1)];
    expect(
      stockChanges({ lines, status: 'confirmed' }, { lines: after, status: 'confirmed' }),
    ).toEqual([
      { variantId: 'v1', productId: 'p1', change: -1 },
      { variantId: 'v2', productId: 'p2', change: 1 },
      { variantId: 'v3', productId: 'p1', change: -1 },
    ]);
  });

  it('moves nothing for a new order’s edit, or for lines without a variant', () => {
    expect(
      stockChanges({ lines, status: 'new' }, { lines: [line('v9', 5)], status: 'new' }),
    ).toEqual([]);
    expect(
      stockChanges(
        { lines: [line(null, 4)], status: 'new' },
        { lines: [line(null, 4)], status: 'confirmed' },
      ),
    ).toEqual([]);
  });

  it('sorts by variant id, so concurrent writers touch rows in the same order', () => {
    const unsorted = [line('vb', 1), line('va', 1)];
    expect(
      stockChanges(
        { lines: unsorted, status: 'new' },
        { lines: unsorted, status: 'confirmed' },
      ).map((change) => change.variantId),
    ).toEqual(['va', 'vb']);
  });
});

describe('buildLines', () => {
  const variant = (id: string, overrides: Partial<OrderableVariant> = {}): OrderableVariant => ({
    id,
    productId: 'p1',
    productName: 'Blue kurti',
    variantName: 'L',
    sku: `SKU-${id}`,
    price: 170000,
    stock: 3,
    live: true,
    ...overrides,
  });
  const current = [
    {
      productId: 'p1',
      variantId: 'v1',
      productName: 'Blue kurti (old name)',
      variantName: 'M',
      sku: 'OLD-M',
      quantity: 2,
      unitPrice: 160000,
    },
  ] as OrderItemRow[];

  it('keeps an existing line’s snapshot, even for a variant since archived', () => {
    const lines = buildLines(
      [{ variantId: 'v1', quantity: 5 }],
      current,
      new Map([['v1', variant('v1', { live: false, price: 999 })]]),
    );
    expect(lines).toEqual([
      {
        productId: 'p1',
        variantId: 'v1',
        productName: 'Blue kurti (old name)',
        variantName: 'M',
        sku: 'OLD-M',
        quantity: 5,
        unitPrice: 160000,
      },
    ]);
  });

  it('snapshots a new variant from the catalog, and takes a price the seller sets', () => {
    const lines = buildLines(
      [
        { variantId: 'v2', quantity: 1 },
        { variantId: 'v1', quantity: 2, unitPrice: 150000 },
      ],
      current,
      new Map([['v2', variant('v2')]]),
    );
    expect(lines.map((l) => [l.variantId, l.productName, l.sku, l.unitPrice])).toEqual([
      ['v2', 'Blue kurti', 'SKU-v2', 170000],
      ['v1', 'Blue kurti (old name)', 'OLD-M', 150000],
    ]);
    expect(subtotalOf(lines)).toBe(170000 + 2 * 150000);
  });

  it('refuses a new variant that is archived or unknown', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return ((error as HttpException).getResponse() as { code: string }).code;
      }
      return null;
    };
    const archived = new Map([['v2', variant('v2', { live: false })]]);
    expect(code(() => buildLines([{ variantId: 'v2', quantity: 1 }], [], archived))).toBe(
      'VARIANT_NOT_FOUND',
    );
    expect(code(() => buildLines([{ variantId: 'v3', quantity: 1 }], [], archived))).toBe(
      'VARIANT_NOT_FOUND',
    );
  });
});

describe('planOrderPatch', () => {
  const row = {
    subtotal: 320000,
    deliveryFee: 6000,
    total: 326000,
    customerName: 'Nusrat Jahan',
    phone: '01712-345678',
    deliveryAddress: 'House 12, Road 4, Mirpur 10',
    deliveryArea: 'Local',
    deliveryChargeId: null,
    deliveryEverywhereElse: false,
    deliveryTime: null,
    paymentStatus: 'unpaid',
    paymentMethod: 'cash_on_delivery',
    trackingNumber: null,
    notes: null,
  } as OrderRow;

  it('treats a field sent back unchanged as no change', () => {
    expect(
      planOrderPatch(row, {
        customerName: 'Nusrat Jahan',
        deliveryFee: 6000,
        trackingNumber: null,
      }),
    ).toEqual({ changes: {}, events: [], touchesDelivery: false });
  });

  it('recomputes the total with the delivery charge and lists the delivery fields changed', () => {
    const plan = planOrderPatch(row, { deliveryFee: 12000, deliveryArea: null });
    expect(plan.changes).toEqual({ deliveryFee: 12000, total: 332000, deliveryArea: null });
    expect(plan.events).toEqual([{ type: 'delivery_changed', fields: ['area', 'fee'] }]);
    expect(plan.touchesDelivery).toBe(true);
  });

  it('records a moved area once, whether its name, its link or both changed', () => {
    const chargeId = '6f1c2b8e-4a1d-4c6e-9d2f-0b7a3e5c1d24';
    const plan = planOrderPatch(
      row,
      { deliveryArea: 'Gazipur' },
      {
        deliveryChargeId: chargeId,
        deliveryArea: 'Gazipur',
        deliveryEverywhereElse: false,
        deliveryTime: '2–3 days',
      },
    );
    expect(plan.changes).toEqual({
      deliveryChargeId: chargeId,
      deliveryArea: 'Gazipur',
      deliveryTime: '2–3 days',
    });
    expect(plan.events).toEqual([{ type: 'delivery_changed', fields: ['area'] }]);
  });

  it('records payment and tracking without touching delivery, and the note without an event', () => {
    const plan = planOrderPatch(row, {
      paymentStatus: 'paid',
      trackingNumber: 'PTH-123',
      note: 'Call before delivery',
    });
    expect(plan.changes).toEqual({
      paymentStatus: 'paid',
      trackingNumber: 'PTH-123',
      notes: 'Call before delivery',
    });
    expect(plan.events).toEqual([
      { type: 'payment_changed', status: { from: 'unpaid', to: 'paid' } },
      { type: 'tracking_changed', trackingNumber: 'PTH-123' },
    ]);
    expect(plan.touchesDelivery).toBe(false);
  });
});

describe('orderEventDataSchema', () => {
  it('reads delivery changes stored before the area and fee rename', () => {
    expect(
      orderEventDataSchema.parse({ type: 'delivery_changed', fields: ['zone', 'charge'] }),
    ).toEqual({ type: 'delivery_changed', fields: ['area', 'fee'] });
  });
});
