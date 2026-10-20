import { formatMinorUnitsTrimmed, type Category, type SellableProduct } from '@app/shared';
import type { CatalogView } from '../catalog-match';
import { browseReply, MAX_CAROUSEL_CARDS } from '../entry-replies';

const cat = (id: string, name: string): Category => ({ id, name }) as Category;
const SAREES = cat('00000000-0000-4000-8000-0000000000a1', 'Sarees');
const KURTIS = cat('00000000-0000-4000-8000-0000000000a2', 'Kurtis');
const EMPTY = cat('00000000-0000-4000-8000-0000000000a3', 'Shoes');

let n = 0;
const product = (
  name: string,
  categoryIds: string[],
  prices: { price: number; available: number }[],
): SellableProduct => {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    id,
    name,
    description: null,
    status: 'active',
    aliases: [],
    categoryIds,
    images: [
      {
        id: `${id.slice(0, -4)}ffff`,
        url: `https://img.test/${n}.jpg`,
        thumbnailUrl: `https://img.test/${n}-t.jpg`,
        position: 0,
        width: 800,
        height: 800,
      },
    ],
    coverImageId: `${id.slice(0, -4)}ffff`,
    options: [],
    customDelivery: false,
    deliveryCharges: [],
    variants: prices.map((entry, index) => ({
      id: `${id.slice(0, -4)}${String(index).padStart(4, '0')}`,
      name: `V${index}`,
      sku: `S${n}-${index}`,
      price: entry.price,
      stock: entry.available,
      reserved: 0,
      available: entry.available,
      stockStatus: entry.available > 0 ? 'in_stock' : 'out_of_stock',
      isDefault: index === 0,
      imageId: null,
      optionValueIds: [],
    })),
    version: '1',
  } as SellableProduct;
};

const jamdani = product(
  'Jamdani saree',
  [SAREES.id],
  [
    { price: 450_000, available: 3 },
    { price: 300_000, available: 0 },
  ],
);
const kurti = product('Blue kurti', [KURTIS.id], [{ price: 160_050, available: 2 }]);
const soldOut = product('Silk saree', [EMPTY.id], [{ price: 900_000, available: 0 }]);
const loose = product('Gift card', [], [{ price: 50_000, available: 9 }]);
const catalog: CatalogView = {
  products: [jamdani, kurti, soldOut, loose],
  categories: [SAREES, KURTIS, EMPTY],
};

describe('browseReply', () => {
  it('lists categories with something available, plus Other for uncategorised products', () => {
    expect(browseReply(catalog, null, 'en', 'BDT')).toEqual({
      kind: 'browse_categories',
      choices: [
        { id: SAREES.id, title: 'Sarees' },
        { id: KURTIS.id, title: 'Kurtis' },
        { id: 'other', title: 'Other' },
      ],
    });
  });

  it('goes straight to products when there is only one bucket', () => {
    const one: CatalogView = { products: [kurti], categories: [KURTIS] };
    expect(browseReply(one, null, 'en', 'BDT')).toMatchObject({
      kind: 'browse_products',
      cards: [{ id: kurti.id }],
    });
  });

  it('quotes "From" the lowest available price only', () => {
    expect(browseReply(catalog, SAREES.id, 'en', 'BDT')).toEqual({
      kind: 'browse_products',
      cards: [
        {
          id: jamdani.id,
          title: 'Jamdani saree',
          subtitle: `From ${formatMinorUnitsTrimmed(450_000, 'BDT', 'en-US')}`,
          imageUrl: 'https://img.test/1.jpg',
        },
      ],
      more: false,
    });
  });

  it('shows the Other bucket', () => {
    expect(browseReply(catalog, 'other', 'en', 'BDT')).toMatchObject({
      kind: 'browse_products',
      cards: [{ id: loose.id }],
    });
  });

  it('caps the carousel at ten and says there is more', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      product(`Kurti ${i}`, [KURTIS.id], [{ price: 100_000, available: 1 }]),
    );
    const reply = browseReply({ products: many, categories: [KURTIS] }, KURTIS.id, 'en', 'BDT');
    expect(reply).toMatchObject({ kind: 'browse_products', more: true });
    expect(reply.kind === 'browse_products' && reply.cards).toHaveLength(MAX_CAROUSEL_CARDS);
  });

  it('answers an unknown or emptied category with the category list', () => {
    expect(browseReply(catalog, EMPTY.id, 'en', 'BDT').kind).toBe('browse_categories');
    expect(browseReply(catalog, '00000000-0000-4000-8000-0000000000ff', 'en', 'BDT').kind).toBe(
      'browse_categories',
    );
  });

  it('hands off to the seller when nothing is available at all', () => {
    expect(browseReply({ products: [soldOut], categories: [EMPTY] }, null, 'en', 'BDT')).toEqual({
      kind: 'handoff',
      reason: 'awaiting_seller',
    });
  });
});
