import { HttpException, Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { createProductSchema } from '@app/shared';
import { isCodedErrorBody } from '../../src/common/errors/coded-exceptions';
import { CategoriesService } from '../../src/modules/categories/categories.service';
import { DATABASE, type Database } from '../../src/modules/database/database.module';
import { organization, product } from '../../src/modules/database/schema/index';
import { withMerchant } from '../../src/modules/database/with-merchant';
import { DeliveryChargesRepository } from '../../src/modules/settings/delivery-charges.repository';
import { ProductsService } from '../../src/modules/products/products.service';
import { SEED_CATEGORIES, SEED_PRODUCTS, type SeedProduct } from './seed-catalog';
import { fillerNumber, fillerProducts } from './seed-filler';

export interface SeedOptions {
  /** Generated products to add after the hand-written ones. */
  count: number;
  /** Delete the shop's products first; any an order points at are kept. */
  reset: boolean;
}

export interface SeedSummary {
  removed: number;
  keptInUse: number;
  created: number;
  skipped: number;
  filler: number;
}

/** A refusal the command prints as is: no shop to seed, or no single obvious one. */
export class SeedTargetError extends Error {}

/**
 * Fills a shop's catalog for development through ProductsService and
 * CategoriesService, so every row passes the same validation and tenancy as
 * one made in the dashboard. Safe to re-run: categories and hand-written
 * products that already exist by name are reused or skipped.
 */
@Injectable()
export class ProductSeeder {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly deliveryCharges: DeliveryChargesRepository,
  ) {}

  /** The shop with this slug or, without one, the only shop there is. */
  async findOrganization(slug?: string): Promise<{ id: string; slug: string; name: string }> {
    const shops = await this.db
      .select({ id: organization.id, slug: organization.slug, name: organization.name })
      .from(organization)
      .orderBy(asc(organization.createdAt));
    const listed = shops.map((shop) => `  ${shop.slug}  (${shop.name})`).join('\n');

    if (slug !== undefined) {
      const shop = shops.find((s) => s.slug === slug);
      if (!shop) throw new SeedTargetError(`No shop has the slug "${slug}". Shops:\n${listed}`);
      return shop;
    }
    if (shops.length === 0) {
      throw new SeedTargetError('No shop to seed. Sign up in the dashboard first.');
    }
    if (shops.length > 1) {
      throw new SeedTargetError(`Several shops exist; pick one with --org <slug>:\n${listed}`);
    }
    return shops[0]!;
  }

  async run(merchantId: string, { count, reset }: SeedOptions): Promise<SeedSummary> {
    const summary: SeedSummary = { removed: 0, keptInUse: 0, created: 0, skipped: 0, filler: 0 };
    if (reset) Object.assign(summary, await this.removeAll(merchantId));

    const categoryIds = await this.ensureCategories(merchantId);
    const charges = await withMerchant(this.db, merchantId, (tx) =>
      this.deliveryCharges.list(tx, { merchantId }),
    );
    const names = await this.productNames(merchantId);
    const taken = new Set(names.map((name) => name.toLowerCase()));

    for (const seed of SEED_PRODUCTS) {
      if (taken.has(seed.name.toLowerCase())) {
        summary.skipped++;
        continue;
      }
      await this.create(merchantId, seed, categoryIds, charges);
      summary.created++;
    }

    const lastFiller = Math.max(0, ...names.map((name) => fillerNumber(name) ?? 0));
    for (const seed of fillerProducts(count, lastFiller)) {
      await this.create(merchantId, seed, categoryIds, charges);
      summary.filler++;
    }
    return summary;
  }

  private async create(
    merchantId: string,
    seed: SeedProduct,
    categoryIds: Map<string, string>,
    charges: { id: string; charge: number }[],
  ): Promise<void> {
    const customDelivery = seed.deliverySurcharge !== undefined;
    await this.products.create(
      merchantId,
      createProductSchema.parse({
        name: seed.name,
        description: seed.description,
        status: seed.status,
        aliases: seed.aliases,
        customDelivery,
        deliveryCharges: customDelivery
          ? charges.map((c) => ({
              deliveryChargeId: c.id,
              charge: c.charge + seed.deliverySurcharge!,
            }))
          : [],
        categoryIds: [categoryIds.get(seed.category)!],
        options: seed.options.map((o) => ({
          name: o.name,
          values: o.values.map((value) => ({ value })),
        })),
        variants: seed.variants,
      }),
    );
  }

  /** Category name -> id, creating the seed's categories the shop lacks. */
  private async ensureCategories(merchantId: string): Promise<Map<string, string>> {
    const existing = await this.categories.list(merchantId);
    const ids = new Map<string, string>();
    for (const name of SEED_CATEGORIES) {
      const found = existing.find((c) => c.name.toLowerCase() === name.toLowerCase());
      ids.set(name, found ? found.id : (await this.categories.create(merchantId, { name })).id);
    }
    return ids;
  }

  private productNames(merchantId: string): Promise<string[]> {
    return withMerchant(this.db, merchantId, async (tx) =>
      (
        await tx
          .select({ name: product.name })
          .from(product)
          .where(eq(product.merchantId, merchantId))
      ).map((row) => row.name),
    );
  }

  private async removeAll(merchantId: string): Promise<Pick<SeedSummary, 'removed' | 'keptInUse'>> {
    const ids = await withMerchant(this.db, merchantId, async (tx) =>
      (
        await tx.select({ id: product.id }).from(product).where(eq(product.merchantId, merchantId))
      ).map((row) => row.id),
    );
    let removed = 0;
    let keptInUse = 0;
    for (const id of ids) {
      try {
        await this.products.remove(merchantId, id);
        removed++;
      } catch (error) {
        if (!isProductInUse(error)) throw error;
        keptInUse++;
      }
    }
    return { removed, keptInUse };
  }
}

function isProductInUse(error: unknown): boolean {
  if (!(error instanceof HttpException)) return false;
  const body = error.getResponse();
  return isCodedErrorBody(body) && body.code === 'PRODUCT_IN_USE';
}
