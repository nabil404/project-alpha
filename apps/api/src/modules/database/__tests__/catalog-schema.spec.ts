import { and, eq } from 'drizzle-orm';
import * as schema from '../schema/index';
import {
  describeDb,
  openCatalogTestDb,
  pgErrorOf,
  seedCategory,
  seedImage,
  seedOption,
  seedOptionValue,
  seedProduct,
  seedVariant,
  type CatalogTestDb,
} from './catalog-test-db';

describeDb('catalog schema constraints', () => {
  let t: CatalogTestDb;

  beforeAll(async () => {
    t = await openCatalogTestDb();
  });

  afterAll(async () => {
    await t.close();
  });

  describe('composite foreign keys keep links inside one merchant', () => {
    it("rejects a variant on another merchant's product", async () => {
      const productOfA = await seedProduct(t.db, t.merchantA);
      await expect(pgErrorOf(seedVariant(t.db, t.merchantB, productOfA.id))).resolves.toEqual({
        code: '23503',
        constraint: 'product_variant_product_fk',
      });
    });

    it("rejects a category under another merchant's category", async () => {
      const parentOfA = await seedCategory(t.db, t.merchantA);
      await expect(
        pgErrorOf(seedCategory(t.db, t.merchantB, { parentId: parentOfA.id })),
      ).resolves.toEqual({ code: '23503', constraint: 'category_parent_fk' });
    });

    it("rejects linking a product to another merchant's category", async () => {
      const productOfA = await seedProduct(t.db, t.merchantA);
      const categoryOfB = await seedCategory(t.db, t.merchantB);
      await expect(
        pgErrorOf(
          t.db.insert(schema.productCategory).values({
            merchantId: t.merchantA,
            productId: productOfA.id,
            categoryId: categoryOfB.id,
          }),
        ),
      ).resolves.toEqual({ code: '23503', constraint: 'product_category_category_fk' });
    });

    it('rejects a category as its own parent', async () => {
      const cat = await seedCategory(t.db, t.merchantA);
      await expect(
        pgErrorOf(
          t.db
            .update(schema.category)
            .set({ parentId: cat.id })
            .where(eq(schema.category.id, cat.id)),
        ),
      ).resolves.toEqual({ code: '23514', constraint: 'category_not_own_parent_ck' });
    });
  });

  describe('checks', () => {
    it('rejects a negative price, stock or delivery charge', async () => {
      const product = await seedProduct(t.db, t.merchantA);
      await expect(
        pgErrorOf(seedVariant(t.db, t.merchantA, product.id, { price: -1 })),
      ).resolves.toEqual({
        code: '23514',
        constraint: 'product_variant_price_ck',
      });
      await expect(
        pgErrorOf(seedVariant(t.db, t.merchantA, product.id, { stock: -1 })),
      ).resolves.toEqual({
        code: '23514',
        constraint: 'product_variant_stock_ck',
      });
      await expect(
        pgErrorOf(seedProduct(t.db, t.merchantA, { deliveryCharge: -1 })),
      ).resolves.toEqual({
        code: '23514',
        constraint: 'product_delivery_charge_ck',
      });
    });

    it('ties is_default to an unnamed variant, both ways', async () => {
      const product = await seedProduct(t.db, t.merchantA);
      await expect(
        pgErrorOf(seedVariant(t.db, t.merchantA, product.id, { name: 'M', isDefault: true })),
      ).resolves.toEqual({ code: '23514', constraint: 'product_variant_default_unnamed_ck' });
      await expect(
        pgErrorOf(seedVariant(t.db, t.merchantA, product.id, { name: null, isDefault: false })),
      ).resolves.toEqual({ code: '23514', constraint: 'product_variant_default_unnamed_ck' });
    });
  });

  describe('partial unique indexes', () => {
    it('allows one live default variant per product', async () => {
      const product = await seedProduct(t.db, t.merchantA);
      await seedVariant(t.db, t.merchantA, product.id, { name: null, isDefault: true });
      await expect(
        pgErrorOf(seedVariant(t.db, t.merchantA, product.id, { name: null, isDefault: true })),
      ).resolves.toEqual({ code: '23505', constraint: 'product_variant_default_live_uidx' });
    });

    it('keeps SKUs unique per merchant among live variants, released on archive', async () => {
      const product = await seedProduct(t.db, t.merchantA);
      const first = await seedVariant(t.db, t.merchantA, product.id, { sku: 'SCHEMA-SKU-1' });
      await expect(
        pgErrorOf(seedVariant(t.db, t.merchantA, product.id, { name: 'L', sku: 'SCHEMA-SKU-1' })),
      ).resolves.toEqual({ code: '23505', constraint: 'product_variant_merchant_sku_live_uidx' });

      const productOfB = await seedProduct(t.db, t.merchantB);
      await expect(
        seedVariant(t.db, t.merchantB, productOfB.id, { sku: 'SCHEMA-SKU-1' }),
      ).resolves.toMatchObject({ sku: 'SCHEMA-SKU-1' });

      await t.db
        .update(schema.productVariant)
        .set({ archivedAt: new Date() })
        .where(eq(schema.productVariant.id, first.id));
      await expect(
        seedVariant(t.db, t.merchantA, product.id, { name: 'XL', sku: 'SCHEMA-SKU-1' }),
      ).resolves.toMatchObject({ sku: 'SCHEMA-SKU-1' });
    });

    it('keeps category names unique per merchant across the tree, ignoring case, released on delete', async () => {
      const root = await seedCategory(t.db, t.merchantA, { name: 'Schema Kids' });
      const other = await seedCategory(t.db, t.merchantA, { name: 'Schema Men' });
      await expect(
        pgErrorOf(seedCategory(t.db, t.merchantA, { name: 'SCHEMA KIDS', parentId: other.id })),
      ).resolves.toEqual({ code: '23505', constraint: 'category_merchant_name_live_uidx' });

      await expect(seedCategory(t.db, t.merchantB, { name: 'Schema Kids' })).resolves.toBeDefined();

      await t.db
        .update(schema.category)
        .set({ deletedAt: new Date() })
        .where(eq(schema.category.id, root.id));
      await expect(seedCategory(t.db, t.merchantA, { name: 'Schema Kids' })).resolves.toBeDefined();
    });
  });

  it('deleting a product cascades to its variants and category links', async () => {
    const product = await seedProduct(t.db, t.merchantA);
    await seedVariant(t.db, t.merchantA, product.id);
    const cat = await seedCategory(t.db, t.merchantA);
    await t.db
      .insert(schema.productCategory)
      .values({ merchantId: t.merchantA, productId: product.id, categoryId: cat.id });

    await t.db.delete(schema.product).where(eq(schema.product.id, product.id));

    await expect(
      t.db
        .select()
        .from(schema.productVariant)
        .where(eq(schema.productVariant.productId, product.id)),
    ).resolves.toHaveLength(0);
    await expect(
      t.db
        .select()
        .from(schema.productCategory)
        .where(
          and(
            eq(schema.productCategory.merchantId, t.merchantA),
            eq(schema.productCategory.productId, product.id),
          ),
        ),
    ).resolves.toHaveLength(0);
  });

  describe('product images', () => {
    it("rejects an image on another merchant's product", async () => {
      const productOfA = await seedProduct(t.db, t.merchantA);
      await expect(pgErrorOf(seedImage(t.db, t.merchantB, productOfA.id))).resolves.toEqual({
        code: '23503',
        constraint: 'product_image_product_fk',
      });
    });

    it("rejects a variant pointing at another merchant's image", async () => {
      const productOfA = await seedProduct(t.db, t.merchantA);
      const productOfB = await seedProduct(t.db, t.merchantB);
      const imageOfB = await seedImage(t.db, t.merchantB, productOfB.id);
      await expect(
        pgErrorOf(seedVariant(t.db, t.merchantA, productOfA.id, { imageId: imageOfB.id })),
      ).resolves.toEqual({ code: '23503', constraint: 'product_variant_image_fk' });
    });

    it('clears only image_id on a variant when its image is deleted', async () => {
      const product = await seedProduct(t.db, t.merchantA);
      const image = await seedImage(t.db, t.merchantA, product.id);
      const variant = await seedVariant(t.db, t.merchantA, product.id, { imageId: image.id });

      await t.db.delete(schema.productImage).where(eq(schema.productImage.id, image.id));

      const [after] = await t.db
        .select()
        .from(schema.productVariant)
        .where(eq(schema.productVariant.id, variant.id));
      expect(after).toMatchObject({ imageId: null, merchantId: t.merchantA });
    });

    it('removes images with their product', async () => {
      const product = await seedProduct(t.db, t.merchantA);
      const image = await seedImage(t.db, t.merchantA, product.id);
      await seedVariant(t.db, t.merchantA, product.id, { imageId: image.id });

      await t.db.delete(schema.product).where(eq(schema.product.id, product.id));

      await expect(
        t.db.select().from(schema.productImage).where(eq(schema.productImage.id, image.id)),
      ).resolves.toHaveLength(0);
    });
  });

  describe('product options', () => {
    const link = (merchantId: string, variantId: string, optionId: string, optionValueId: string) =>
      t.db
        .insert(schema.productVariantOptionValue)
        .values({ merchantId, variantId, optionId, optionValueId });

    it('holds one value per option per variant', async () => {
      const product = await seedProduct(t.db, t.merchantA);
      const variant = await seedVariant(t.db, t.merchantA, product.id);
      const size = await seedOption(t.db, t.merchantA, product.id, { name: 'Size' });
      const m = await seedOptionValue(t.db, t.merchantA, size.id, { value: 'M' });
      const l = await seedOptionValue(t.db, t.merchantA, size.id, { value: 'L', position: 1 });

      await link(t.merchantA, variant.id, size.id, m.id);
      await expect(pgErrorOf(link(t.merchantA, variant.id, size.id, l.id))).resolves.toEqual({
        code: '23505',
        constraint: 'product_variant_option_value_pk',
      });
    });

    it('rejects a link whose value belongs to a different option', async () => {
      const product = await seedProduct(t.db, t.merchantA);
      const variant = await seedVariant(t.db, t.merchantA, product.id);
      const size = await seedOption(t.db, t.merchantA, product.id, { name: 'Size' });
      const sleeve = await seedOption(t.db, t.merchantA, product.id, {
        name: 'Sleeve',
        position: 1,
      });
      const short = await seedOptionValue(t.db, t.merchantA, sleeve.id, { value: 'Short' });

      await expect(pgErrorOf(link(t.merchantA, variant.id, size.id, short.id))).resolves.toEqual({
        code: '23503',
        constraint: 'product_variant_option_value_value_fk',
      });
    });

    it("rejects an option on another merchant's product", async () => {
      const productOfA = await seedProduct(t.db, t.merchantA);
      await expect(pgErrorOf(seedOption(t.db, t.merchantB, productOfA.id))).resolves.toEqual({
        code: '23503',
        constraint: 'product_option_product_fk',
      });
    });

    it('removes its values and their variant links with an option', async () => {
      const product = await seedProduct(t.db, t.merchantA);
      const variant = await seedVariant(t.db, t.merchantA, product.id);
      const size = await seedOption(t.db, t.merchantA, product.id);
      const m = await seedOptionValue(t.db, t.merchantA, size.id);
      await link(t.merchantA, variant.id, size.id, m.id);

      await t.db.delete(schema.productOption).where(eq(schema.productOption.id, size.id));

      await expect(
        t.db
          .select()
          .from(schema.productOptionValue)
          .where(eq(schema.productOptionValue.optionId, size.id)),
      ).resolves.toHaveLength(0);
      await expect(
        t.db
          .select()
          .from(schema.productVariantOptionValue)
          .where(eq(schema.productVariantOptionValue.variantId, variant.id)),
      ).resolves.toHaveLength(0);
    });
  });

  describe('the cover image', () => {
    it('clears only cover_image_id when its image is deleted', async () => {
      const product = await seedProduct(t.db, t.merchantA);
      const image = await seedImage(t.db, t.merchantA, product.id);
      const byId = eq(schema.product.id, product.id);
      await t.db.update(schema.product).set({ coverImageId: image.id }).where(byId);

      await t.db.delete(schema.productImage).where(eq(schema.productImage.id, image.id));

      const [row] = await t.db.select().from(schema.product).where(byId);
      expect(row).toMatchObject({ coverImageId: null, merchantId: t.merchantA });
    });

    it("rejects another merchant's image as the cover", async () => {
      const productOfA = await seedProduct(t.db, t.merchantA);
      const productOfB = await seedProduct(t.db, t.merchantB);
      const imageOfB = await seedImage(t.db, t.merchantB, productOfB.id);

      await expect(
        pgErrorOf(
          t.db
            .update(schema.product)
            .set({ coverImageId: imageOfB.id })
            .where(eq(schema.product.id, productOfA.id)),
        ),
      ).resolves.toEqual({ code: '23503', constraint: 'product_cover_image_fk' });
    });

    it('starts a new product at revision 0 with no cover', async () => {
      const product = await seedProduct(t.db, t.merchantA);
      expect(product).toMatchObject({ revision: 0, coverImageId: null });
    });
  });
});
