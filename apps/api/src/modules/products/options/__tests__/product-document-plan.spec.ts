import { randomUUID } from 'node:crypto';
import type { HttpException } from '@nestjs/common';
import { productVariantInputSchema, type ProductVariantInput } from '@app/shared';
import {
  EMPTY_PRODUCT_STATE,
  planProductDocument,
  variantLabel,
  type CurrentProductState,
} from '../product-document-plan';

const variant = (fields: Partial<ProductVariantInput>): ProductVariantInput =>
  productVariantInputSchema.parse({ price: 1000, ...fields });

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return (error as HttpException).getResponse();
  }
  throw new Error('expected a throw');
}

describe('variantLabel', () => {
  it('joins values, and is null without any', () => {
    expect(variantLabel(['M', 'Short'])).toBe('M / Short');
    expect(variantLabel([])).toBeNull();
  });

  it("prefers the seller's name, but never names the default variant", () => {
    expect(variantLabel(['S', 'Short'], 'Small, short')).toBe('Small, short');
    expect(variantLabel(['S', 'Short'], '')).toBe('S / Short');
    expect(variantLabel([], 'Anything')).toBeNull();
  });
});

describe('planProductDocument', () => {
  const ids = {
    size: randomUUID(),
    s: randomUUID(),
    m: randomUUID(),
    vS: randomUUID(),
    vM: randomUUID(),
  };
  const images = [randomUUID(), randomUUID()];
  const stored: CurrentProductState = {
    options: [{ id: ids.size, values: [{ id: ids.s }, { id: ids.m }] }],
    variantIds: [ids.vS, ids.vM],
    imageIds: images,
  };
  const sizeOption = (values: { id?: string; value: string }[]) => ({
    id: ids.size,
    name: 'Size',
    values,
  });

  it('plans a create: everything new, positions in order, labels from values', () => {
    const plan = planProductDocument(EMPTY_PRODUCT_STATE, {
      options: [
        { name: 'Size', values: [{ value: 'S' }, { value: 'M' }] },
        { name: 'Sleeve', values: [{ value: 'Short' }] },
      ],
      variants: [variant({ optionValues: ['m', 'SHORT'], sku: ' kur-1 ' })],
    });

    expect(plan.options).toEqual([
      {
        id: null,
        name: 'Size',
        position: 0,
        values: [
          { id: null, value: 'S', position: 0 },
          { id: null, value: 'M', position: 1 },
        ],
      },
      {
        id: null,
        name: 'Sleeve',
        position: 1,
        values: [{ id: null, value: 'Short', position: 0 }],
      },
    ]);
    expect(plan.variants).toEqual([
      {
        id: null,
        name: 'M / Short',
        sku: 'KUR-1',
        price: 1000,
        stock: 0,
        imageId: null,
        valueRefs: [
          { option: 0, value: 1 },
          { option: 1, value: 0 },
        ],
      },
    ]);
    expect(plan).toMatchObject({
      archiveVariantIds: [],
      deleteOptionIds: [],
      deleteValueIds: [],
      coverImageId: undefined,
    });
  });

  it('keeps ids through a rename, and the label follows the new text', () => {
    const plan = planProductDocument(stored, {
      options: [
        sizeOption([
          { id: ids.s, value: 'S' },
          { id: ids.m, value: 'Medium' },
        ]),
      ],
      variants: [
        variant({ id: ids.vS, optionValues: ['S'] }),
        variant({ id: ids.vM, optionValues: ['medium'] }),
      ],
    });

    expect(plan.options[0]?.values.map((v) => v.id)).toEqual([ids.s, ids.m]);
    expect(plan.variants.map((v) => [v.id, v.name])).toEqual([
      [ids.vS, 'S'],
      [ids.vM, 'Medium'],
    ]);
    expect(plan.archiveVariantIds).toEqual([]);
    expect(plan.deleteValueIds).toEqual([]);
  });

  it("keeps the seller's name through a value rename", () => {
    const plan = planProductDocument(stored, {
      options: [sizeOption([{ id: ids.s, value: 'Small' }])],
      variants: [variant({ id: ids.vS, name: 'Petite', optionValues: ['Small'] })],
    });
    expect(plan.variants[0]?.name).toBe('Petite');
  });

  it('deletes the values left out and archives the variants left out', () => {
    const plan = planProductDocument(stored, {
      options: [sizeOption([{ id: ids.s, value: 'S' }])],
      variants: [variant({ id: ids.vS, optionValues: ['S'] })],
    });
    expect(plan.deleteValueIds).toEqual([ids.m]);
    expect(plan.archiveVariantIds).toEqual([ids.vM]);
  });

  it('deletes an option left out, without listing its values separately', () => {
    const plan = planProductDocument(stored, { options: [], variants: [variant({ id: ids.vS })] });
    expect(plan.deleteOptionIds).toEqual([ids.size]);
    expect(plan.deleteValueIds).toEqual([]);
    expect(plan.variants[0]).toMatchObject({ id: ids.vS, name: null, valueRefs: [] });
  });

  it("refuses an option id or value id that isn't this product's option's", () => {
    expect(
      codeOf(() =>
        planProductDocument(stored, {
          options: [{ id: randomUUID(), name: 'Size', values: [{ value: 'S' }] }],
          variants: [variant({ optionValues: ['S'] })],
        }),
      ),
    ).toMatchObject({ code: 'PRODUCT_OPTION_NOT_FOUND' });
    expect(
      codeOf(() =>
        planProductDocument(stored, {
          options: [{ name: 'Fit', values: [{ id: ids.s, value: 'S' }] }],
          variants: [variant({ optionValues: ['S'] })],
        }),
      ),
    ).toMatchObject({ code: 'PRODUCT_OPTION_NOT_FOUND', params: { id: ids.s } });
  });

  it("refuses a variant id that isn't a live variant of this product", () => {
    expect(
      codeOf(() =>
        planProductDocument(stored, {
          options: [sizeOption([{ id: ids.s, value: 'S' }])],
          variants: [variant({ id: randomUUID(), optionValues: ['S'] })],
        }),
      ),
    ).toMatchObject({ code: 'VARIANT_NOT_FOUND' });
  });

  it("treats an image the product doesn't have as none, for a variant or the cover", () => {
    const gone = randomUUID();
    const plan = planProductDocument(stored, {
      options: [sizeOption([{ id: ids.s, value: 'S' }])],
      variants: [variant({ optionValues: ['S'], imageId: gone })],
      coverImageId: gone,
    });
    expect(plan.variants[0]?.imageId).toBeNull();
    expect(plan.coverImageId).toBe(images[0]);
  });

  it('keeps a given cover, picks the first photo for null, and leaves undefined alone', () => {
    const base = {
      options: [sizeOption([{ id: ids.s, value: 'S' }])],
      variants: [variant({ optionValues: ['S'] })],
    };
    expect(planProductDocument(stored, { ...base, coverImageId: images[1] }).coverImageId).toBe(
      images[1],
    );
    expect(planProductDocument(stored, { ...base, coverImageId: null }).coverImageId).toBe(
      images[0],
    );
    expect(
      planProductDocument({ ...stored, imageIds: [] }, { ...base, coverImageId: null })
        .coverImageId,
    ).toBeNull();
    expect(planProductDocument(stored, base).coverImageId).toBeUndefined();
  });
});
