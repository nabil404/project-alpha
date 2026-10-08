import { randomUUID } from 'node:crypto';
import { saveProductSchema, type SaveProduct } from '@app/shared';
import { zodIssuesToFields } from '../../../common/errors/validation-fields';

const doc = (overrides: Partial<Record<keyof SaveProduct, unknown>> = {}) => ({
  version: '3',
  name: 'Blue kurti',
  options: [
    { name: 'Size', values: [{ value: 'S' }, { value: 'M' }] },
    { name: 'Sleeve', values: [{ value: 'Short' }, { value: 'Long' }] },
  ],
  variants: [
    { optionValues: ['S', 'Short'], price: 160000, stock: 2 },
    { optionValues: ['M', 'Long'], price: 160000, stock: 4 },
  ],
  ...overrides,
});

/** The wire `fields` map reduced to codes: what the SPA shows under each control. */
function fieldCodes(input: unknown): Record<string, string[]> {
  const result = saveProductSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(
    Object.entries(zodIssuesToFields(result.error.issues)).map(([path, errors]) => [
      path,
      errors.map((error) => error.code),
    ]),
  );
}

describe('saveProductSchema', () => {
  it('uses the shop delivery charges unless told otherwise', () => {
    const parsed = saveProductSchema.parse(doc());
    expect(parsed).toMatchObject({ customDelivery: false, deliveryCharges: [] });
  });

  it("refuses the same area twice in a product's own delivery charges", () => {
    const area = randomUUID();
    expect(
      fieldCodes(
        doc({
          customDelivery: true,
          deliveryCharges: [
            { deliveryChargeId: area, charge: 8000 },
            { deliveryChargeId: area, charge: 9000 },
          ],
        }),
      ),
    ).toEqual({ 'deliveryCharges.1.deliveryChargeId': ['DUPLICATE'] });
  });

  it('accepts a product without options sold as one variant, filling defaults', () => {
    const parsed = saveProductSchema.parse(doc({ options: [], variants: [{ price: 50000 }] }));
    expect(parsed.variants).toEqual([{ optionValues: [], price: 50000, stock: 0, imageId: null }]);
    expect(parsed.coverImageId).toBeNull();
    expect(parsed.categoryIds).toEqual([]);
  });

  it('matches a variant value to its option by trimmed, case-insensitive text', () => {
    expect(fieldCodes(doc({ variants: [{ optionValues: [' s ', 'short'], price: 1 }] }))).toEqual(
      {},
    );
  });

  it('refuses more than one variant without options', () => {
    expect(fieldCodes(doc({ options: [], variants: [{ price: 1 }, { price: 2 }] }))).toEqual({
      variants: ['VARIANTS_NEED_OPTION'],
    });
  });

  it('refuses two options with the same name, ignoring case and spaces', () => {
    expect(
      fieldCodes(
        doc({
          options: [
            { name: 'Size', values: [{ value: 'S' }] },
            { name: ' size', values: [{ value: 'M' }] },
          ],
          variants: [{ optionValues: ['S', 'M'], price: 1 }],
        }),
      ),
    ).toEqual({ 'options.1.name': ['DUPLICATE'] });
  });

  it('refuses repeated values within one option', () => {
    expect(
      fieldCodes(
        doc({
          options: [{ name: 'Size', values: [{ value: 'M' }, { value: 'm' }] }],
          variants: [{ optionValues: ['M'], price: 1 }],
        }),
      ),
    ).toEqual({ 'options.0.values.1.value': ['DUPLICATE'] });
  });

  it('refuses a variant that does not pick one value per option', () => {
    expect(fieldCodes(doc({ variants: [{ optionValues: ['S'], price: 1 }] }))).toEqual({
      'variants.0.optionValues': ['OPTION_VALUES_MISMATCH'],
    });
  });

  it("refuses a value its option doesn't have", () => {
    expect(fieldCodes(doc({ variants: [{ optionValues: ['XL', 'Short'], price: 1 }] }))).toEqual({
      'variants.0.optionValues.0': ['UNKNOWN_OPTION_VALUE'],
    });
  });

  it('accepts a name for a variant, trimmed', () => {
    const parsed = saveProductSchema.parse(
      doc({
        variants: [
          { name: ' Small, short ', optionValues: ['S', 'Short'], price: 1 },
          { optionValues: ['M', 'Long'], price: 1 },
        ],
      }),
    );
    expect(parsed.variants.map((v) => v.name)).toEqual(['Small, short', undefined]);
  });

  it("refuses a name another variant has, or that is another's values", () => {
    expect(
      fieldCodes(
        doc({
          variants: [
            { name: 'Everyday', optionValues: ['S', 'Short'], price: 1 },
            { name: 'everyday ', optionValues: ['M', 'Long'], price: 1 },
          ],
        }),
      ),
    ).toEqual({ 'variants.1.name': ['DUPLICATE'] });
    expect(
      fieldCodes(
        doc({
          variants: [
            { optionValues: ['S', 'Short'], price: 1 },
            { name: 's / short', optionValues: ['M', 'Long'], price: 1 },
          ],
        }),
      ),
    ).toEqual({ 'variants.1.name': ['DUPLICATE'] });
  });

  it('refuses two variants with the same values, ignoring case', () => {
    expect(
      fieldCodes(
        doc({
          variants: [
            { optionValues: ['S', 'Short'], price: 1 },
            { optionValues: ['s', 'SHORT'], price: 1 },
          ],
        }),
      ),
    ).toEqual({ 'variants.1.optionValues': ['DUPLICATE'] });
  });

  it('refuses two variants sharing a SKU, ignoring case and spaces', () => {
    expect(
      fieldCodes(
        doc({
          variants: [
            { optionValues: ['S', 'Short'], sku: 'kur-1', price: 1 },
            { optionValues: ['M', 'Long'], sku: ' KUR-1 ', price: 1 },
          ],
        }),
      ),
    ).toEqual({ 'variants.1.sku': ['DUPLICATE'] });
  });

  it('refuses the same variant id twice', () => {
    const id = randomUUID();
    expect(
      fieldCodes(
        doc({
          variants: [
            { id, optionValues: ['S', 'Short'], price: 1 },
            { id, optionValues: ['M', 'Long'], price: 1 },
          ],
        }),
      ),
    ).toEqual({ 'variants.1.id': ['DUPLICATE'] });
  });

  it('refuses more than three options', () => {
    const options = ['A', 'B', 'C', 'D'].map((name) => ({ name, values: [{ value: 'x' }] }));
    expect(
      fieldCodes(doc({ options, variants: [{ optionValues: ['x', 'x', 'x', 'x'], price: 1 }] })),
    ).toMatchObject({ options: ['MAX_ITEMS'] });
  });

  it('requires the version the page read', () => {
    expect(fieldCodes(doc({ version: undefined }))).toEqual({ version: ['REQUIRED'] });
  });
});
