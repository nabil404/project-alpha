import { eq } from 'drizzle-orm';
import * as schema from '../../database/schema/index';
import { withMerchant } from '../../database/with-merchant';
import { CategoriesRepository } from '../categories.repository';
import { CategoriesService } from '../categories.service';
import {
  describeDb,
  expectCoded,
  openCatalogTestDb,
  seedProduct,
  type CatalogTestDb,
} from '../../database/__tests__/catalog-test-db';

describeDb('CategoriesService', () => {
  let t: CatalogTestDb;
  let service: CategoriesService;
  let n = 0;
  /** Names are unique per merchant, so every test uses fresh ones. */
  const fresh = (label: string) => `${label} ${++n}`;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    service = new CategoriesService(t.db, new CategoriesRepository());
  });

  afterAll(async () => {
    await t.close();
  });

  describe('create', () => {
    it('creates categories and lists them', async () => {
      const kids = await service.create(t.merchantA, { name: fresh('Kids') });
      const boys = await service.create(t.merchantA, { name: fresh('Boys') });

      expect(kids).toEqual({
        id: expect.any(String),
        name: expect.stringContaining('Kids'),
        productCount: 0,
      });
      const listed = await service.list(t.merchantA);
      expect(listed.map((c) => c.id)).toEqual(expect.arrayContaining([kids.id, boys.id]));
    });

    it('trims the name', async () => {
      const name = fresh('Eid');
      const created = await service.create(t.merchantA, { name: `  ${name}  ` });
      expect(created.name).toBe(name);
    });

    it('rejects a taken name case-insensitively and after trimming', async () => {
      const name = fresh('Kids');
      await service.create(t.merchantA, { name });
      await expectCoded(
        service.create(t.merchantA, { name: name.toUpperCase() }),
        'CATEGORY_NAME_TAKEN',
      );
      await expectCoded(
        service.create(t.merchantA, { name: ` ${name.toLowerCase()} ` }),
        'CATEGORY_NAME_TAKEN',
      );
    });

    it("does not collide with another merchant's names", async () => {
      const name = fresh('Shared');
      await service.create(t.merchantA, { name });
      await expect(service.create(t.merchantB, { name })).resolves.toMatchObject({
        name,
      });
    });
  });

  describe('update', () => {
    it('renames, including a case-only change to its own name', async () => {
      const cat = await service.create(t.merchantA, { name: fresh('kids') });
      const renamed = await service.update(t.merchantA, cat.id, { name: cat.name.toUpperCase() });
      expect(renamed.name).toBe(cat.name.toUpperCase());
    });

    it("cannot touch another merchant's category", async () => {
      const ofA = await service.create(t.merchantA, { name: fresh('Mine') });
      await expectCoded(
        service.update(t.merchantB, ofA.id, { name: fresh('Theirs') }),
        'CATEGORY_NOT_FOUND',
      );
    });

    it("rejects a rename to another live category's name, case-insensitively", async () => {
      const taken = await service.create(t.merchantA, { name: fresh('Taken') });
      const cat = await service.create(t.merchantA, { name: fresh('Renamer') });
      await expectCoded(
        service.update(t.merchantA, cat.id, { name: taken.name.toUpperCase() }),
        'CATEGORY_NAME_TAKEN',
      );
    });

    it('returns CATEGORY_NOT_FOUND, not a bare error, for a rename target already deleted', async () => {
      const cat = await service.create(t.merchantA, { name: fresh('AlreadyGone') });
      await service.remove(t.merchantA, cat.id);
      await expectCoded(
        service.update(t.merchantA, cat.id, { name: fresh('X') }),
        'CATEGORY_NOT_FOUND',
      );
    });

    it('CategoriesRepository.update returns undefined when the row lost the race to a delete', async () => {
      const cat = await service.create(t.merchantA, { name: fresh('RaceLoser') });
      await service.remove(t.merchantA, cat.id);

      const repo = new CategoriesRepository();
      await withMerchant(t.db, t.merchantA, async (tx) => {
        const result = await repo.update(tx, { merchantId: t.merchantA }, cat.id, {
          name: fresh('WontApply'),
        });
        expect(result).toBeUndefined();
      });
    });

    it('never surfaces a bare Error when a rename races a concurrent remove', async () => {
      const cat = await service.create(t.merchantA, { name: fresh('Racer') });

      const results = await Promise.allSettled([
        service.update(t.merchantA, cat.id, { name: fresh('RenamedDuringRace') }),
        service.remove(t.merchantA, cat.id),
      ]);

      for (const result of results) {
        if (result.status === 'rejected') {
          await expectCoded(Promise.reject(result.reason), 'CATEGORY_NOT_FOUND');
        }
      }
    });
  });

  describe('remove', () => {
    it('soft-deletes, unlinks products, drops it from the list and frees the name', async () => {
      const name = fresh('Bye');
      const cat = await service.create(t.merchantA, { name });
      const product = await seedProduct(t.db, t.merchantA);
      await t.db
        .insert(schema.productCategory)
        .values({ merchantId: t.merchantA, productId: product.id, categoryId: cat.id });

      await service.remove(t.merchantA, cat.id);

      const [row] = await t.db.select().from(schema.category).where(eq(schema.category.id, cat.id));
      expect(row?.deletedAt).toBeInstanceOf(Date);
      await expect(
        t.db
          .select()
          .from(schema.productCategory)
          .where(eq(schema.productCategory.categoryId, cat.id)),
      ).resolves.toHaveLength(0);
      expect((await service.list(t.merchantA)).map((c) => c.id)).not.toContain(cat.id);
      await expect(service.create(t.merchantA, { name })).resolves.toMatchObject({
        name,
      });
    });

    it("cannot delete another merchant's category, and lists stay separate", async () => {
      const ofA = await service.create(t.merchantA, { name: fresh('Keep') });
      await expectCoded(service.remove(t.merchantB, ofA.id), 'CATEGORY_NOT_FOUND');
      expect((await service.list(t.merchantB)).map((c) => c.id)).not.toContain(ofA.id);
    });
  });

  describe('product counts', () => {
    const link = (merchantId: string, productId: string, categoryId: string) =>
      t.db.insert(schema.productCategory).values({ merchantId, productId, categoryId });
    const countOf = async (merchantId: string, id: string) =>
      (await service.list(merchantId)).find((c) => c.id === id)?.productCount;

    it('counts linked products of every status, and zero for an empty category', async () => {
      const full = await service.create(t.merchantA, { name: fresh('Full') });
      const empty = await service.create(t.merchantA, { name: fresh('Empty') });
      for (const status of ['draft', 'active', 'archived'] as const) {
        const product = await seedProduct(t.db, t.merchantA, { status });
        await link(t.merchantA, product.id, full.id);
      }

      expect(await countOf(t.merchantA, full.id)).toBe(3);
      expect(await countOf(t.merchantA, empty.id)).toBe(0);
    });

    it('drops a deleted product from the count', async () => {
      const cat = await service.create(t.merchantA, { name: fresh('Shrinks') });
      const kept = await seedProduct(t.db, t.merchantA);
      const gone = await seedProduct(t.db, t.merchantA);
      await link(t.merchantA, kept.id, cat.id);
      await link(t.merchantA, gone.id, cat.id);

      await t.db.delete(schema.product).where(eq(schema.product.id, gone.id));

      expect(await countOf(t.merchantA, cat.id)).toBe(1);
    });

    it('returns the count from a rename', async () => {
      const cat = await service.create(t.merchantA, { name: fresh('Counted') });
      await link(t.merchantA, (await seedProduct(t.db, t.merchantA)).id, cat.id);
      await link(t.merchantA, (await seedProduct(t.db, t.merchantA)).id, cat.id);

      const renamed = await service.update(t.merchantA, cat.id, { name: fresh('Recounted') });
      expect(renamed.productCount).toBe(2);
    });

    it("counts only the merchant's own links", async () => {
      const ofA = await service.create(t.merchantA, { name: fresh('A only') });
      const ofB = await service.create(t.merchantB, { name: fresh('B only') });
      await link(t.merchantA, (await seedProduct(t.db, t.merchantA)).id, ofA.id);
      await link(t.merchantB, (await seedProduct(t.db, t.merchantB)).id, ofB.id);
      await link(t.merchantB, (await seedProduct(t.db, t.merchantB)).id, ofB.id);

      expect(await countOf(t.merchantA, ofA.id)).toBe(1);
      expect(await countOf(t.merchantB, ofB.id)).toBe(2);
    });
  });
});
