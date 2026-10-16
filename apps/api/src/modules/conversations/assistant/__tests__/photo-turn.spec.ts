import type { Product } from '@app/shared';
import type { MessageRow } from '../../../database/schema/index';
import type { CatalogView } from '../catalog-match';
import {
  matchedProductIds,
  MAX_PHOTO_CANDIDATES,
  MAX_PHOTOS_PER_TURN,
  photoMatchRequest,
  photosIn,
  photoShortlist,
} from '../photo-turn';
import { EVAL_PRODUCTS, productByKey } from './fixtures/match-eval';

const SAREES = '00000000-0000-4000-8000-0000000000a1';

/** The eval product with a cover photo, in the sarees category when asked. */
function covered(product: Product, categoryIds: string[] = []): Product {
  const imageId = `00000000-0000-4000-8000-${product.id.slice(-12)}`;
  return {
    ...product,
    categoryIds,
    coverImageId: imageId,
    images: [
      {
        id: imageId,
        url: `https://media.example.test/m/x/${imageId}.jpg`,
        thumbnailUrl: `https://media.example.test/m/x/${imageId}-thumb.jpg`,
        position: 0,
        width: 100,
        height: 100,
      },
    ],
  };
}

const jamdani = covered(productByKey('jamdani'), [SAREES]);
const katan = covered(productByKey('katan'), [SAREES]);
const threePiece = covered(productByKey('threepiece'));
const catalog: CatalogView = {
  products: [threePiece, jamdani, katan],
  categories: [{ id: SAREES, name: 'Saree' }],
};

let at = 0;
const row = (overrides: Partial<MessageRow>): MessageRow =>
  ({
    id: `m${at++}`,
    sender: 'customer',
    kind: 'text',
    text: '',
    editedText: null,
    deletedAt: null,
    ...overrides,
  }) as MessageRow;

describe('photosIn', () => {
  it("collects the burst's photos, newest first, and the words beside them", () => {
    const newestFirst = [
      row({ id: 'words', text: 'do you have this?' }),
      row({ id: 'p2', kind: 'image' }),
      row({ id: 'p1', kind: 'image' }),
      row({ id: 'reply', sender: 'assistant', text: 'Hello!' }),
      row({ id: 'old', kind: 'image' }),
    ];
    expect(photosIn(newestFirst, 'words')).toEqual({
      messageIds: ['p2', 'p1'],
      words: 'do you have this?',
    });
  });

  it('reads at most three photos a turn, and skips an unsent one', () => {
    const newestFirst = [
      row({ id: 'p5', kind: 'image' }),
      row({ id: 'gone', kind: 'image', deletedAt: new Date() }),
      row({ id: 'p4', kind: 'image' }),
      row({ id: 'p3', kind: 'image' }),
      row({ id: 'p2', kind: 'image' }),
    ];
    expect(photosIn(newestFirst, 'p5')?.messageIds).toEqual(['p5', 'p4', 'p3']);
    expect(MAX_PHOTOS_PER_TURN).toBe(3);
  });

  it('is null for a burst with no photo', () => {
    expect(photosIn([row({ id: 'words', text: 'hi' })], 'words')).toBeNull();
  });
});

describe('photoShortlist', () => {
  it('keeps only sellable products with a cover', () => {
    const bare = productByKey('jamdani');
    const soldOut = covered({
      ...productByKey('katan'),
      variants: productByKey('katan').variants.map((variant) => ({ ...variant, available: 0 })),
    });
    const ids = photoShortlist({ ...catalog, products: [bare, soldOut, threePiece] }, '').map(
      (product) => product.id,
    );
    expect(ids).toEqual([threePiece.id]);
  });

  it('narrows to a category the customer named', () => {
    expect(photoShortlist(catalog, 'saree ache?').map((product) => product.name)).toEqual([
      jamdani.name,
      katan.name,
    ]);
  });

  it('puts a product the customer named first', () => {
    expect(photoShortlist(catalog, 'katan')[0]?.id).toBe(katan.id);
  });

  it(`shows the model at most ${MAX_PHOTO_CANDIDATES} products`, () => {
    const many = EVAL_PRODUCTS.flatMap((product) =>
      Array.from({ length: 5 }, (_, copy) =>
        covered({ ...product, id: `${product.id.slice(0, -2)}${String(copy).padStart(2, '0')}` }),
      ),
    );
    expect(photoShortlist({ products: many, categories: [] }, '')).toHaveLength(
      Math.min(MAX_PHOTO_CANDIDATES, many.length),
    );
  });
});

describe('photoMatchRequest', () => {
  it('numbers the candidates from 1 and shows their thumbnails', () => {
    expect(photoMatchRequest(['https://media.example.test/c/p.jpg'], [jamdani, katan], '')).toEqual(
      {
        photos: ['https://media.example.test/c/p.jpg'],
        candidates: [
          { number: 1, name: jamdani.name, imageUrl: jamdani.images[0]!.thumbnailUrl },
          { number: 2, name: katan.name, imageUrl: katan.images[0]!.thumbnailUrl },
        ],
      },
    );
  });
});

describe('matchedProductIds', () => {
  const shortlist = [jamdani, katan, threePiece];

  it('maps numbers back to ids, best first', () => {
    expect(
      matchedProductIds(
        {
          matches: [
            { candidate: 2, confidence: 0.7 },
            { candidate: 1, confidence: 0.95 },
          ],
        },
        shortlist,
      ),
    ).toEqual([jamdani.id, katan.id]);
  });

  it('discards a number that was not on the list', () => {
    expect(
      matchedProductIds(
        {
          matches: [
            { candidate: 4, confidence: 0.99 },
            { candidate: 3, confidence: 0.8 },
          ],
        },
        shortlist,
      ),
    ).toEqual([threePiece.id]);
  });

  it('drops a match below the confidence floor, and a product named twice counts once', () => {
    expect(
      matchedProductIds(
        {
          matches: [
            { candidate: 1, confidence: 0.4 },
            { candidate: 2, confidence: 0.9 },
            { candidate: 2, confidence: 0.8 },
          ],
        },
        shortlist,
      ),
    ).toEqual([katan.id]);
  });
});
