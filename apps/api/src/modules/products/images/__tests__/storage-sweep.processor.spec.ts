import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import {
  describeDb,
  openCatalogTestDb,
  openRuntimeDb,
  seedImages,
  seedProduct,
  type CatalogTestDb,
} from '../../../../database/__tests__/catalog-test-db';
import { SWEEP_JOB } from '../../../queue/queue.constants';
import { InMemoryObjectStorage } from '../../../storage/__tests__/in-memory-object-storage';
import { productImageKeys } from '../product-image-keys';
import { ProductImageRepository } from '../product-image.repository';
import { StorageSweepProcessor } from '../storage-sweep.processor';

// As app_runtime: had the lookup run without merchant context, row-level
// security would show no rows and the kept image would be deleted too.
describeDb('StorageSweepProcessor (app_runtime)', () => {
  let t: CatalogTestDb;
  let runtime: ReturnType<typeof openRuntimeDb>;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    t = await openCatalogTestDb();
    runtime = openRuntimeDb();
  });

  afterAll(async () => {
    await runtime.close();
    await t.close();
  });

  it('keeps images that have a row and deletes the orphan, looking rows up under merchant context', async () => {
    const product = await seedProduct(t.db, t.merchantA);
    const [kept] = await seedImages(t.db, t.merchantA, product.id, 1);
    const old = new Date(Date.now() - 48 * 3_600_000);
    const storage = new InMemoryObjectStorage();
    const keptKeys = productImageKeys(t.merchantA, kept!.id);
    const orphanKeys = productImageKeys(t.merchantA, randomUUID());
    for (const key of [keptKeys.full, keptKeys.thumbnail, orphanKeys.full, orphanKeys.thumbnail]) {
      storage.seed(key, old);
    }

    const processor = new StorageSweepProcessor(
      {} as Queue,
      runtime.db,
      storage,
      new ProductImageRepository(),
    );
    const report = await processor.process({ name: SWEEP_JOB } as Job);

    expect(report).toMatchObject({ examined: 4, orphans: 2, deleted: 2, aborted: false });
    expect([...storage.objects.keys()].sort()).toEqual([keptKeys.full, keptKeys.thumbnail].sort());
  });

  it('refuses a job it does not know', async () => {
    const processor = new StorageSweepProcessor(
      {} as Queue,
      runtime.db,
      new InMemoryObjectStorage(),
      new ProductImageRepository(),
    );

    await expect(processor.process({ name: 'something-else' } as Job)).rejects.toThrow(
      /something-else/,
    );
  });
});
