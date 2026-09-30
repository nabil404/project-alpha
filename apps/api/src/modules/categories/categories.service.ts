import { Inject, Injectable } from '@nestjs/common';
import type { Category, CreateCategory, UpdateCategory } from '@app/shared';
import { DATABASE, type Database } from '../database/database.module';
import { withMerchant } from '../database/with-merchant';
import { categoryNotFound, guardCategoryName } from './category-errors';
import { toCategory } from './category-mappers';
import { CategoriesRepository } from './categories.repository';

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly categories: CategoriesRepository,
  ) {}

  list(merchantId: string): Promise<Category[]> {
    return withMerchant(this.db, merchantId, async (tx) =>
      (await this.categories.listLive(tx, { merchantId })).map(toCategory),
    );
  }

  create(merchantId: string, input: CreateCategory): Promise<Category> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const name = input.name.trim();
      const row = await guardCategoryName(name, () =>
        this.categories.insert(tx, { merchantId }, { name }),
      );
      return toCategory(row);
    });
  }

  update(merchantId: string, id: string, input: UpdateCategory): Promise<Category> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      const name = input.name.trim();
      const row = await guardCategoryName(name, () =>
        this.categories.update(tx, scope, id, { name }),
      );
      // Missing, deleted, or lost a race to a concurrent delete.
      if (!row) throw categoryNotFound(id);
      return toCategory(row);
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
