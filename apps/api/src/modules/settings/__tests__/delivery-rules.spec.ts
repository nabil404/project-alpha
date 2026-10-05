import {
  areaKey,
  deliveryFeeFor,
  normalizeAreaName,
  saveDeliverySettingsSchema,
} from '@app/shared';

const everywhereElse = { charge: 12000, deliveryTime: '3–5 days' };

describe('normalizeAreaName / areaKey', () => {
  it('trims and collapses spaces, keeping case', () => {
    expect(normalizeAreaName('  Mirpur   10 ')).toBe('Mirpur 10');
  });

  it('compares ignoring case and spacing', () => {
    expect(areaKey(' dhaka ')).toBe(areaKey('Dhaka'));
  });
});

describe('saveDeliverySettingsSchema', () => {
  const parse = (body: unknown) => saveDeliverySettingsSchema.safeParse(body);

  it('normalizes names and clears a blank time', () => {
    expect(
      parse({
        deliveryCharges: [{ areaName: '  Dhaka ', charge: 6000, deliveryTime: ' ' }],
        everywhereElse,
        freeDeliveryOver: null,
      }).data,
    ).toEqual({
      deliveryCharges: [{ areaName: 'Dhaka', charge: 6000, deliveryTime: null }],
      everywhereElse,
      freeDeliveryOver: null,
    });
  });

  it('flags the second of two names differing only in case or spacing', () => {
    const result = parse({
      deliveryCharges: [
        { areaName: 'Dhaka', charge: 1 },
        { areaName: ' dhaka', charge: 2 },
      ],
      everywhereElse,
      freeDeliveryOver: null,
    });
    expect(result.error?.issues[0]?.path).toEqual(['deliveryCharges', 1, 'areaName']);
  });

  it('requires the everywhere-else charge', () => {
    expect(
      parse({ deliveryCharges: [], everywhereElse: { deliveryTime: null }, freeDeliveryOver: null })
        .success,
    ).toBe(false);
  });

  it('refuses blank names and names with control characters', () => {
    for (const areaName of [' ', 'A\u0001']) {
      expect(
        parse({
          deliveryCharges: [{ areaName, charge: 1 }],
          everywhereElse,
          freeDeliveryOver: null,
        }).success,
      ).toBe(false);
    }
  });

  it('refuses fractional charges and a negative threshold', () => {
    expect(
      parse({
        deliveryCharges: [{ areaName: 'A', charge: 1.5 }],
        everywhereElse,
        freeDeliveryOver: null,
      }).success,
    ).toBe(false);
    expect(parse({ deliveryCharges: [], everywhereElse, freeDeliveryOver: -1 }).success).toBe(
      false,
    );
  });
});

describe('deliveryFeeFor', () => {
  const fee = (
    productCharges: (number | null)[],
    subtotal = 1000,
    freeDeliveryOver: number | null = null,
  ) => deliveryFeeFor({ shopCharge: 6000, productCharges, subtotal, freeDeliveryOver });

  it('is the shop charge with no products, or only shop-charge products', () => {
    expect(fee([])).toBe(6000);
    expect(fee([null, null])).toBe(6000);
  });

  it('takes the highest effective charge, not the sum', () => {
    // Shop ৳60 beats a custom ৳40; a custom ৳90 beats the shop's.
    expect(fee([null, 4000])).toBe(6000);
    expect(fee([9000, null])).toBe(9000);
    // A lone custom product may be cheaper than the shop charge.
    expect(fee([4000])).toBe(4000);
  });

  it('is free at or over the threshold', () => {
    expect(fee([9000], 100000, 100000)).toBe(0);
    expect(fee([9000], 99999, 100000)).toBe(9000);
  });
});
