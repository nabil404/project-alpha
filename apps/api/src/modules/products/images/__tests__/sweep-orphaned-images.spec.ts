import { randomUUID } from 'node:crypto';
import { InMemoryObjectStorage } from '../../../storage/__tests__/in-memory-object-storage.js';
import { productImageKeys } from '../product-image-keys.js';
import { sweepOrphanedImages, SWEEP_DEFAULTS } from '../sweep-orphaned-images.js';

const now = new Date('2026-09-27T03:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const merchantA = 'MerchantAAAAAAAAAAAAAAAAAAAAAAAA';
const merchantB = 'MerchantBBBBBBBBBBBBBBBBBBBBBBBB';

/** Seeds both objects of one image and returns its id. */
function seedImage(storage: InMemoryObjectStorage, merchantId: string, age: Date): string {
  const id = randomUUID();
  const keys = productImageKeys(merchantId, id);
  storage.seed(keys.full, age);
  storage.seed(keys.thumbnail, age);
  return id;
}

/** Answers from a fixed set of rows per merchant, and records which merchant each lookup was for. */
function rows(byMerchant: Record<string, string[]>) {
  const lookups: string[] = [];
  return {
    lookups,
    existingImageIds: async (merchantId: string, ids: string[]) => {
      lookups.push(merchantId);
      const known = new Set(byMerchant[merchantId] ?? []);
      return new Set(ids.filter((id) => known.has(id)));
    },
  };
}

describe('sweepOrphanedImages', () => {
  it('deletes both objects of an image with no row once it is over 24 hours old', async () => {
    const storage = new InMemoryObjectStorage();
    const kept = Array.from({ length: 9 }, () => seedImage(storage, merchantA, hoursAgo(48)));
    const orphan = seedImage(storage, merchantA, hoursAgo(48));

    const report = await sweepOrphanedImages({
      storage,
      now: () => now,
      ...rows({ [merchantA]: kept }),
    });

    expect(report).toEqual({ examined: 20, skipped: 0, orphans: 2, deleted: 2, aborted: false });
    const orphanKeys = productImageKeys(merchantA, orphan);
    expect(storage.objects.has(orphanKeys.full)).toBe(false);
    expect(storage.objects.has(orphanKeys.thumbnail)).toBe(false);
    expect(storage.objects.size).toBe(18);
  });

  it('leaves a recent object alone even without a row, since its upload may still be committing', async () => {
    const storage = new InMemoryObjectStorage();
    seedImage(storage, merchantA, hoursAgo(1));

    const report = await sweepOrphanedImages({ storage, now: () => now, ...rows({}) });

    expect(report.deleted).toBe(0);
    expect(storage.objects.size).toBe(2);
  });

  it('skips keys it cannot parse and never deletes them', async () => {
    const storage = new InMemoryObjectStorage();
    storage.seed('m/not-a-key.txt', hoursAgo(100));
    storage.seed(`m/${merchantA}/nested/${randomUUID()}.jpg`, hoursAgo(100));

    const report = await sweepOrphanedImages({ storage, now: () => now, ...rows({}) });

    expect(report).toMatchObject({ examined: 2, skipped: 2, deleted: 0 });
    expect(storage.objects.size).toBe(2);
  });

  it('looks rows up per merchant, never across merchants', async () => {
    const storage = new InMemoryObjectStorage();
    const idA = seedImage(storage, merchantA, hoursAgo(48));
    const idB = seedImage(storage, merchantB, hoursAgo(48));
    // merchantB's row is registered under merchantA: a cross-merchant lookup would keep it.
    const lookup = rows({ [merchantA]: [idA, idB] });

    await sweepOrphanedImages({ storage, now: () => now, ...lookup });

    expect(new Set(lookup.lookups)).toEqual(new Set([merchantA, merchantB]));
    expect(storage.objects.has(productImageKeys(merchantB, idB).full)).toBe(false);
    expect(storage.objects.has(productImageKeys(merchantA, idA).full)).toBe(true);
  });

  it('deletes nothing when orphans exceed 20% and number more than 10', async () => {
    const storage = new InMemoryObjectStorage();
    const kept = Array.from({ length: 20 }, () => seedImage(storage, merchantA, hoursAgo(48)));
    Array.from({ length: 6 }, () => seedImage(storage, merchantA, hoursAgo(48)));

    const report = await sweepOrphanedImages({
      storage,
      now: () => now,
      ...rows({ [merchantA]: kept }),
    });

    // 12 orphan objects of 52: 23% and above the floor of 10.
    expect(report).toEqual({ examined: 52, skipped: 0, orphans: 12, deleted: 0, aborted: true });
    expect(storage.objects.size).toBe(52);
  });

  it('does not trip the breaker below the floor, however high the ratio', async () => {
    const storage = new InMemoryObjectStorage();
    const kept = seedImage(storage, merchantA, hoursAgo(48));
    seedImage(storage, merchantA, hoursAgo(48));

    const report = await sweepOrphanedImages({
      storage,
      now: () => now,
      ...rows({ [merchantA]: [kept] }),
    });

    expect(report).toMatchObject({ orphans: 2, deleted: 2, aborted: false });
  });

  it('pages through the whole listing', async () => {
    const storage = new InMemoryObjectStorage();
    storage.pageSize = 3;
    const kept = Array.from({ length: 5 }, () => seedImage(storage, merchantA, hoursAgo(48)));
    seedImage(storage, merchantA, hoursAgo(48));

    const report = await sweepOrphanedImages(
      { storage, now: () => now, ...rows({ [merchantA]: kept }) },
      SWEEP_DEFAULTS,
    );

    expect(report).toMatchObject({ examined: 12, deleted: 2 });
  });
});
