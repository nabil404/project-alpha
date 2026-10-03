import { Inject, Injectable } from '@nestjs/common';
import type { CategoryWithCount, CreateCategory, UpdateCategory } from '@app/shared';
import { DATABASE, type Database } from '../database/database.module';
import { withMerchant } from '../database/with-merchant';
import { categoryNotFound, guardCategoryName } from './category-errors';
import { toCategoryWithCount } from './category-mappers';
import { CategoriesRepository } from './categories.repository';

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly categories: CategoriesRepository,
  ) {}

  list(merchantId: string): Promise<CategoryWithCount[]> {
    return withMerchant(this.db, merchantId, async (tx) =>
      (await this.categories.listLiveWithCounts(tx, { merchantId })).map((row) =>
        toCategoryWithCount(row, row.productCount),
      ),
    );
  }

  create(merchantId: string, input: CreateCategory): Promise<CategoryWithCount> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const name = input.name.trim();
      const row = await guardCategoryName(name, () =>
        this.categories.insert(tx, { merchantId }, { name }),
      );
      // A new category has no products yet.
      return toCategoryWithCount(row, 0);
    });
  }

  update(merchantId: string, id: string, input: UpdateCategory): Promise<CategoryWithCount> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      const name = input.name.trim();
      const row = await guardCategoryName(name, () =>
        this.categories.update(tx, scope, id, { name }),
      );
      // Missing, deleted, or lost a race to a concurrent delete.
      if (!row) throw categoryNotFound(id);
      return toCategoryWithCount(row, await this.categories.countProducts(tx, scope, id));
    });
  }

  remove(merchantId: string, id: string): Promise<void> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      // Same lock as product links, so none can be written after the check.
      await this.categories.lockCategories(tx, scope);
      if (!(await this.categories.findLive(tx, scope, id))) throw categoryNotFound(id);
      await this.categories.softDelete(tx, scope, id);
    });
  }
}
