import {
  collectedSlotsSchema,
  nextMissingSlot,
  parseCustomerPhone,
  phoneDigitForms,
  toLatinDigits,
} from '@app/shared';

describe('nextMissingSlot', () => {
  it('asks in order: product, quantity, name, phone, address', () => {
    expect(nextMissingSlot({})).toBe('product');
    expect(nextMissingSlot({ productText: 'red saree' })).toBe('quantity');
    expect(nextMissingSlot({ productText: 'red saree', quantity: 2 })).toBe('customerName');
    expect(nextMissingSlot({ productText: 'red saree', quantity: 2, customerName: 'Rahim' })).toBe(
      'phone',
    );
    expect(
      nextMissingSlot({
        productText: 'red saree',
        quantity: 2,
        customerName: 'Rahim',
        phone: '+8801812000000',
      }),
    ).toBe('deliveryAddress');
  });

  it('counts a matched product id as the product', () => {
    expect(nextMissingSlot({ productId: '6f1c1f0e-6f8a-4d43-9a43-6f2b3b1c0d11' })).toBe('quantity');
  });

  it('returns null when every slot is filled; a variant is never required', () => {
    expect(
      nextMissingSlot({
        productText: 'red saree',
        quantity: 2,
        customerName: 'Rahim',
        phone: '+8801812000000',
        deliveryAddress: 'House 12, Road 5, Dhanmondi',
      }),
    ).toBeNull();
  });

  it('parses the ask counter and rejects an unknown slot name', () => {
    expect(collectedSlotsSchema.parse({ lastAsked: { slot: 'phone', times: 2 } })).toEqual({
      lastAsked: { slot: 'phone', times: 2 },
    });
    expect(
      collectedSlotsSchema.safeParse({ lastAsked: { slot: 'colour', times: 1 } }).success,
    ).toBe(false);
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
