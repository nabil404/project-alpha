import {
  collectedSlotsSchema,
  emptySlots,
  encodePayload,
  MAX_ORDER_ITEMS,
  nextMissingSlot,
  parsePayload,
  parseCustomerPhone,
  phoneDigitForms,
  toLatinDigits,
  type CollectedSlots,
} from '@app/shared';

const P1 = '6f1c1f0e-6f8a-4d43-9a43-6f2b3b1c0d11';
const P2 = '7a2d2e1f-1b2c-4d5e-8f90-112233445566';
const V1 = '8b3e3f2a-2c3d-4e5f-9a01-223344556677';
const slots = (overrides: Partial<CollectedSlots> = {}): CollectedSlots => ({
  ...emptySlots(),
  ...overrides,
});
const noVariants = () => false;

describe('nextMissingSlot', () => {
  it('asks for a first product when there are no items', () => {
    expect(nextMissingSlot(slots(), noVariants)).toEqual({ slot: 'product', item: 0 });
  });

  it('walks each item (product, variant when needed, quantity), then the order details', () => {
    const items = [
      { productQuery: 'saree', productId: P1, quantity: 1 },
      { productQuery: 'kurti', productId: P2 },
    ];
    expect(nextMissingSlot(slots({ items: [{ productQuery: 'saree' }] }), noVariants)).toEqual({
      slot: 'product',
      item: 0,
    });
    expect(nextMissingSlot(slots({ items }), noVariants)).toEqual({ slot: 'quantity', item: 1 });
    expect(nextMissingSlot(slots({ items }), (id) => id === P2)).toEqual({
      slot: 'variant',
      item: 1,
    });
    const complete = [items[0]!, { ...items[1]!, variantId: V1, quantity: 2 }];
    expect(nextMissingSlot(slots({ items: complete }), noVariants)).toEqual({
      slot: 'customerName',
    });
    expect(nextMissingSlot(slots({ items: complete, customerName: 'Rahim' }), noVariants)).toEqual({
      slot: 'phone',
    });
    expect(
      nextMissingSlot(
        slots({ items: complete, customerName: 'Rahim', phone: '+8801812000000' }),
        noVariants,
      ),
    ).toEqual({ slot: 'deliveryAddress' });
    expect(
      nextMissingSlot(
        slots({
          items: complete,
          customerName: 'Rahim',
          phone: '+8801812000000',
          deliveryAddress: 'House 12, Road 5, Dhanmondi',
        }),
        noVariants,
      ),
    ).toBeNull();
  });

  it('reads an older shape as nothing collected, and rejects an unknown slot name', () => {
    expect(collectedSlotsSchema.parse({ productText: 'red saree', quantity: 2 })).toEqual(
      emptySlots(),
    );
    expect(
      collectedSlotsSchema.parse({ lastAsked: { slot: 'variant', item: 1, times: 2 } }),
    ).toEqual(slots({ lastAsked: { slot: 'variant', item: 1, times: 2 } }));
    expect(
      collectedSlotsSchema.safeParse({ lastAsked: { slot: 'colour', times: 1 } }).success,
    ).toBe(false);
  });

  it(`holds at most ${MAX_ORDER_ITEMS} items`, () => {
    const items = Array.from({ length: MAX_ORDER_ITEMS + 1 }, () => ({ productQuery: 'saree' }));
    expect(collectedSlotsSchema.safeParse({ items }).success).toBe(false);
  });
});

describe('assistant payloads', () => {
  const conversationId = '11111111-2222-4333-8444-555555555555';

  it('round-trips every kind', () => {
    for (const payload of [
      { kind: 'confirm', conversationId, revision: 3 },
      { kind: 'change', conversationId, revision: 0 },
      { kind: 'pick', slot: 'product', id: P1 },
      { kind: 'pick', slot: 'variant', id: V1 },
      { kind: 'name' },
      { kind: 'not_it' },
    ] as const) {
      expect(parsePayload(encodePayload(payload))).toEqual(payload);
    }
  });

  it('reads anything it did not encode as null', () => {
    for (const text of [
      '',
      'GET_STARTED',
      `confirm:${conversationId}`,
      `confirm:${conversationId}:-1`,
      `confirm:not-a-uuid:1`,
      `pick:size:${P1}`,
      `pick:product:${P1}:extra`,
      'photo:yes',
    ]) {
      expect(parsePayload(text)).toBeNull();
    }
  });
});

describe('parseCustomerPhone', () => {
  it('reads a local Bangladeshi number as E.164', () => {
    expect(parseCustomerPhone('01812-000000', 'BD')).toBe('+8801812000000');
  });

  it('reads an international number whatever the shop country', () => {
    expect(parseCustomerPhone('+880 1812 000000', 'IN')).toBe('+8801812000000');
  });

  it('reads Bangla digits', () => {
    expect(toLatinDigits('০১৮১২০০০০০০')).toBe('01812000000');
    expect(parseCustomerPhone('০১৮১২০০০০০০', 'BD')).toBe('+8801812000000');
  });

  it('rejects a number with a digit missing, and junk', () => {
    expect(parseCustomerPhone('0181200000', 'BD')).toBeNull();
    expect(parseCustomerPhone('123456', 'BD')).toBeNull();
    expect(parseCustomerPhone('my number is secret', 'BD')).toBeNull();
  });

  it("uses the shop's own country for a local number elsewhere", () => {
    expect(parseCustomerPhone('98765 43210', 'IN')).toBe('+919876543210');
  });

  it('ignores an unknown country code instead of throwing', () => {
    expect(parseCustomerPhone('+8801812000000', 'ZZ')).toBe('+8801812000000');
  });
});

describe('phoneDigitForms', () => {
  it('lists the E.164 digits and the national spellings', () => {
    expect(phoneDigitForms('+8801812000000')).toEqual(
      expect.arrayContaining(['8801812000000', '01812000000', '1812000000']),
    );
  });
});
