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
  /** Names are unique per merchant across the whole tree, so every test uses fresh ones. */
  const fresh = (label: string) => `${label} ${++n}`;

  beforeAll(async () => {
    t = await openCatalogTestDb();
    service = new CategoriesService(t.db, new CategoriesRepository());
  });

  afterAll(async () => {
    await t.close();
  });

  describe('create', () => {
    it('creates roots and children and lists only live ones', async () => {
      const root = await service.create(t.merchantA, { name: fresh('Kids'), parentId: null });
      const child = await service.create(t.merchantA, { name: fresh('Boys'), parentId: root.id });

      expect(child.parentId).toBe(root.id);
      const listed = await service.list(t.merchantA);
      expect(listed.map((c) => c.id)).toEqual(expect.arrayContaining([root.id, child.id]));
    });

    it('trims the name', async () => {
      const name = fresh('Eid');
      const created = await service.create(t.merchantA, { name: `  ${name}  `, parentId: null });
      expect(created.name).toBe(name);
    });

    it('rejects a missing, deleted, or other-merchant parent', async () => {
      await expectCoded(
        service.create(t.merchantA, {
          name: fresh('X'),
          parentId: '00000000-0000-4000-8000-000000000000',
        }),
        'CATEGORY_NOT_FOUND',
      );

      const deleted = await service.create(t.merchantA, { name: fresh('Gone'), parentId: null });
      await service.remove(t.merchantA, deleted.id);
      await expectCoded(
        service.create(t.merchantA, { name: fresh('X'), parentId: deleted.id }),
        'CATEGORY_NOT_FOUND',
      );

      const ofB = await service.create(t.merchantB, { name: fresh('B root'), parentId: null });
      await expectCoded(
        service.create(t.merchantA, { name: fresh('X'), parentId: ofB.id }),
        'CATEGORY_NOT_FOUND',
      );
    });

    it('allows three levels and rejects a fourth', async () => {
      const l1 = await service.create(t.merchantA, { name: fresh('L1'), parentId: null });
      const l2 = await service.create(t.merchantA, { name: fresh('L2'), parentId: l1.id });
      const l3 = await service.create(t.merchantA, { name: fresh('L3'), parentId: l2.id });
      await expectCoded(
        service.create(t.merchantA, { name: fresh('L4'), parentId: l3.id }),
        'CATEGORY_TOO_DEEP',
      );
    });

    it('rejects a taken name case-insensitively, whatever the parent, and after trimming', async () => {
      const name = fresh('Kids');
      const root = await service.create(t.merchantA, { name, parentId: null });
      await expectCoded(
        service.create(t.merchantA, { name: name.toUpperCase(), parentId: root.id }),
        'CATEGORY_NAME_TAKEN',
      );
      await expectCoded(
        service.create(t.merchantA, { name: ` ${name.toLowerCase()} `, parentId: null }),
        'CATEGORY_NAME_TAKEN',
      );
    });

    it("does not collide with another merchant's names", async () => {
      const name = fresh('Shared');
      await service.create(t.merchantA, { name, parentId: null });
      await expect(service.create(t.merchantB, { name, parentId: null })).resolves.toMatchObject({
        name,
      });
    });
  });

  describe('update', () => {
    it('renames, including a case-only change to its own name', async () => {
      const cat = await service.create(t.merchantA, { name: fresh('kids'), parentId: null });
      const renamed = await service.update(t.merchantA, cat.id, { name: cat.name.toUpperCase() });
      expect(renamed.name).toBe(cat.name.toUpperCase());
    });

    it('returns the category unchanged when given no fields', async () => {
      const cat = await service.create(t.merchantA, { name: fresh('Still'), parentId: null });
      await expect(service.update(t.merchantA, cat.id, {})).resolves.toEqual(cat);
    });

    it('moves to the root with parentId null, and to its current parent again', async () => {
      const root = await service.create(t.merchantA, { name: fresh('R'), parentId: null });
      const child = await service.create(t.merchantA, { name: fresh('C'), parentId: root.id });
      await expect(
        service.update(t.merchantA, child.id, { parentId: root.id }),
      ).resolves.toMatchObject({
        parentId: root.id,
      });
      await expect(
        service.update(t.merchantA, child.id, { parentId: null }),
      ).resolves.toMatchObject({
        parentId: null,
      });
    });

    it('rejects moving under itself or a descendant', async () => {
      const a = await service.create(t.merchantA, { name: fresh('A'), parentId: null });
      const b = await service.create(t.merchantA, { name: fresh('B'), parentId: a.id });
      const c = await service.create(t.merchantA, { name: fresh('C'), parentId: b.id });
      await expectCoded(service.update(t.merchantA, a.id, { parentId: a.id }), 'CATEGORY_CYCLE');
      await expectCoded(service.update(t.merchantA, a.id, { parentId: c.id }), 'CATEGORY_CYCLE');
    });

    it('counts the moved subtree toward the depth limit', async () => {
      const x1 = await service.create(t.merchantA, { name: fresh('X1'), parentId: null });
      const x2 = await service.create(t.merchantA, { name: fresh('X2'), parentId: x1.id });
      const y1 = await service.create(t.merchantA, { name: fresh('Y1'), parentId: null });
      await service.create(t.merchantA, { name: fresh('Y2'), parentId: y1.id });
      // y1 (height 2) under x2 (depth 2) would make four levels.
      await expectCoded(
        service.update(t.merchantA, y1.id, { parentId: x2.id }),
        'CATEGORY_TOO_DEEP',
      );
      await expect(service.update(t.merchantA, y1.id, { parentId: x1.id })).resolves.toMatchObject({
        parentId: x1.id,
      });
    });

    it('lets exactly one of two opposite concurrent moves win', async () => {
      const a = await service.create(t.merchantA, { name: fresh('Race A'), parentId: null });
      const b = await service.create(t.merchantA, { name: fresh('Race B'), parentId: null });

      const results = await Promise.allSettled([
        service.update(t.merchantA, a.id, { parentId: b.id }),
        service.update(t.merchantA, b.id, { parentId: a.id }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      await expectCoded(
        Promise.reject((rejected as PromiseRejectedResult).reason),
        'CATEGORY_CYCLE',
      );
    });

    it("cannot touch another merchant's category", async () => {
      const ofA = await service.create(t.merchantA, { name: fresh('Mine'), parentId: null });
      await expectCoded(
        service.update(t.merchantB, ofA.id, { name: fresh('Theirs') }),
        'CATEGORY_NOT_FOUND',
      );
    });

    it("rejects a rename to another live category's name, case-insensitively", async () => {
      const taken = await service.create(t.merchantA, { name: fresh('Taken'), parentId: null });
      const cat = await service.create(t.merchantA, { name: fresh('Renamer'), parentId: null });
      await expectCoded(
        service.update(t.merchantA, cat.id, { name: taken.name.toUpperCase() }),
        'CATEGORY_NAME_TAKEN',
      );
    });

    it('returns CATEGORY_NOT_FOUND, not a bare error, for a rename target already deleted', async () => {
      const cat = await service.create(t.merchantA, { name: fresh('AlreadyGone'), parentId: null });
      await service.remove(t.merchantA, cat.id);
      await expectCoded(
        service.update(t.merchantA, cat.id, { name: fresh('X') }),
        'CATEGORY_NOT_FOUND',
      );
    });

    it('CategoriesRepository.update returns undefined when the row lost the race to a delete', async () => {
      const cat = await service.create(t.merchantA, { name: fresh('RaceLoser'), parentId: null });
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
      const cat = await service.create(t.merchantA, { name: fresh('Racer'), parentId: null });

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
    it('refuses while live children exist', async () => {
      const root = await service.create(t.merchantA, { name: fresh('P'), parentId: null });
      await service.create(t.merchantA, { name: fresh('Ch'), parentId: root.id });
      await expectCoded(service.remove(t.merchantA, root.id), 'CATEGORY_HAS_CHILDREN');
    });

    it('soft-deletes, unlinks products, drops it from the list and frees the name', async () => {
      const name = fresh('Bye');
      const cat = await service.create(t.merchantA, { name, parentId: null });
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
      await expect(service.create(t.merchantA, { name, parentId: null })).resolves.toMatchObject({
        name,
      });
    });

    it("cannot delete another merchant's category, and lists stay separate", async () => {
      const ofA = await service.create(t.merchantA, { name: fresh('Keep'), parentId: null });
      await expectCoded(service.remove(t.merchantB, ofA.id), 'CATEGORY_NOT_FOUND');
      expect((await service.list(t.merchantB)).map((c) => c.id)).not.toContain(ofA.id);
    });
  });
});
