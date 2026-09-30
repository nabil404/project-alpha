import { eq } from 'drizzle-orm';
import * as schema from '../../../database/schema/index';
import {
  describeDb,
  openCatalogTestDb,
  pgErrorOf,
  seedImage,
  seedProduct,
  seedVariant,
  type CatalogTestDb,
} from '../../../database/__tests__/catalog-test-db';
import { ProductsRepository } from '../../products.repository';
import { ProductOptionsRepository } from '../product-options.repository';

// The admin connection bypasses RLS, so these prove the merchant_id predicate itself.
describeDb('ProductOptionsRepository', () => {
  let t: CatalogTestDb;
  const repo = new ProductOptionsRepository();
  const a = () => ({ merchantId: t.merchantA });
  const b = () => ({ merchantId: t.merchantB });

  beforeAll(async () => {
    t = await openCatalogTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  async function sizedProduct() {
    const product = await seedProduct(t.db, t.merchantA);
    const size = await repo.insertOption(t.db, a(), {
      productId: product.id,
      name: 'Size',
      position: 0,
    });
    const l = await repo.insertValue(t.db, a(), { optionId: size.id, value: 'L', position: 1 });
    const m = await repo.insertValue(t.db, a(), { optionId: size.id, value: 'M', position: 0 });
    return { product, size, m, l };
  }

  it('lists options and values by position, for several products at once', async () => {
    const first = await sizedProduct();
    const second = await sizedProduct();
    const sleeve = await repo.insertOption(t.db, a(), {
      productId: first.product.id,
      name: 'Sleeve',
      position: 1,
    });

    const { options, values } = await repo.listForProducts(t.db, a(), [
      first.product.id,
      second.product.id,
    ]);

    expect(options.filter((o) => o.productId === first.product.id).map((o) => o.name)).toEqual([
      'Size',
      'Sleeve',
    ]);
    expect(options.map((o) => o.id)).toContain(second.size.id);
    expect(values.filter((v) => v.optionId === first.size.id).map((v) => v.value)).toEqual([
      'M',
      'L',
    ]);
    expect(values.some((v) => v.optionId === sleeve.id)).toBe(false);
  });

  it('updates and deletes options and values by id', async () => {
    const { product, size, m, l } = await sizedProduct();
    await repo.updateOption(t.db, a(), size.id, { name: 'Fit', position: 0 });
    await repo.updateValue(t.db, a(), m.id, { value: 'Medium', position: 1 });
    await repo.deleteValues(t.db, a(), [l.id]);

    let listed = await repo.listForProducts(t.db, a(), [product.id]);
    expect(listed.options.map((o) => o.name)).toEqual(['Fit']);
    expect(listed.values.map((v) => [v.value, v.position])).toEqual([['Medium', 1]]);

    await repo.deleteOptions(t.db, a(), [size.id]);
    listed = await repo.listForProducts(t.db, a(), [product.id]);
    expect(listed).toEqual({ options: [], values: [] });
  });

  it("replaces a variant's links", async () => {
    const { product, size, m, l } = await sizedProduct();
    const variant = await seedVariant(t.db, t.merchantA, product.id);

    await repo.setVariantValues(t.db, a(), variant.id, [
      { optionId: size.id, optionValueId: m.id },
    ]);
    await repo.setVariantValues(t.db, a(), variant.id, [
      { optionId: size.id, optionValueId: l.id },
    ]);

    const links = await repo.linksForVariants(t.db, a(), [variant.id]);
    expect(links.map((link) => link.optionValueId)).toEqual([l.id]);
  });

  it("never reads or changes another merchant's rows", async () => {
    const { product, size, m } = await sizedProduct();
    const variant = await seedVariant(t.db, t.merchantA, product.id);
    await repo.setVariantValues(t.db, a(), variant.id, [
      { optionId: size.id, optionValueId: m.id },
    ]);

    expect(await repo.listForProducts(t.db, b(), [product.id])).toEqual({
      options: [],
      values: [],
    });
    expect(await repo.linksForVariants(t.db, b(), [variant.id])).toEqual([]);

    await repo.updateOption(t.db, b(), size.id, { name: 'Hijacked', position: 0 });
    await repo.updateValue(t.db, b(), m.id, { value: 'Hijacked', position: 0 });
    await repo.deleteValues(t.db, b(), [m.id]);
    await repo.deleteOptions(t.db, b(), [size.id]);
    // B's merchant id cannot point at A's variant: the composite key refuses it.
    await expect(
      pgErrorOf(
        repo.setVariantValues(t.db, b(), variant.id, [{ optionId: size.id, optionValueId: m.id }]),
      ),
    ).resolves.toMatchObject({ code: '23503' });

    const listed = await repo.listForProducts(t.db, a(), [product.id]);
    expect(listed.options.map((o) => o.name)).toEqual(['Size']);
    expect(listed.values.map((v) => v.value)).toEqual(['M', 'L']);
    expect(await repo.linksForVariants(t.db, a(), [variant.id])).toHaveLength(1);
  });
});

describeDb('ProductsRepository — revision and cover', () => {
  let t: CatalogTestDb;
  const products = new ProductsRepository();

  beforeAll(async () => {
    t = await openCatalogTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  const revisionOf = async (id: string) =>
    (await t.db.select().from(schema.product).where(eq(schema.product.id, id)))[0]!.revision;

  it('bumps the revision on every product update, even an empty one', async () => {
    const product = await seedProduct(t.db, t.merchantA);
    await products.updateProduct(t.db, { merchantId: t.merchantA }, product.id, {
      name: 'Renamed',
    });
    await products.updateProduct(t.db, { merchantId: t.merchantA }, product.id, {});
    expect(await revisionOf(product.id)).toBe(2);
  });

  it("sets the cover without bumping the revision, and only the merchant's own", async () => {
    const product = await seedProduct(t.db, t.merchantA);
    const image = await seedImage(t.db, t.merchantA, product.id);

    await products.setCoverImage(t.db, { merchantId: t.merchantB }, product.id, image.id);
    expect(
      (await products.findProduct(t.db, { merchantId: t.merchantA }, product.id))?.coverImageId,
    ).toBeNull();

    await products.setCoverImage(t.db, { merchantId: t.merchantA }, product.id, image.id);
    const row = await products.findProduct(t.db, { merchantId: t.merchantA }, product.id);
    expect(row).toMatchObject({ coverImageId: image.id, revision: 0 });
  });
});
