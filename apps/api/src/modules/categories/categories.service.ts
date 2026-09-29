import { Inject, Injectable } from '@nestjs/common';
import {
  CATEGORY_MAX_DEPTH,
  type Category,
  type CreateCategory,
  type UpdateCategory,
} from '@app/shared';
import { CodedConflictException } from '../../common/errors/index';
import type { TenantScope, Transaction } from '../database/base.repository';
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
      const scope = { merchantId };
      const name = input.name.trim();
      if (input.parentId !== null) {
        await this.categories.lockTree(tx, scope);
        await this.assertPlacement(tx, scope, null, input.parentId);
      }
      const row = await guardCategoryName(name, () =>
        this.categories.insert(tx, scope, { name, parentId: input.parentId }),
      );
      return toCategory(row);
    });
  }

  /** `parentId: null` moves to the root; omitted leaves the category where it is. */
  update(merchantId: string, id: string, input: UpdateCategory): Promise<Category> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      const moving = input.parentId !== undefined;
      // Lock before reading, so the category cannot be deleted or re-parented underneath us.
      if (moving) await this.categories.lockTree(tx, scope);

      const current = await this.categories.findLive(tx, scope, id);
      if (!current) throw categoryNotFound(id);

      const name = input.name?.trim();
      if (name === undefined && !moving) return toCategory(current);

      if (input.parentId) await this.assertPlacement(tx, scope, id, input.parentId);

      const row = await guardCategoryName(name, () =>
        this.categories.update(tx, scope, id, { name, parentId: input.parentId }),
      );
      // Lost a race to a concurrent delete: the row existed above but not by now.
      if (!row) throw categoryNotFound(id);
      return toCategory(row);
    });
  }

  remove(merchantId: string, id: string): Promise<void> {
    return withMerchant(this.db, merchantId, async (tx) => {
      const scope = { merchantId };
      // Same lock as creates and moves, so a child cannot appear after the check.
      await this.categories.lockTree(tx, scope);
      if (!(await this.categories.findLive(tx, scope, id))) throw categoryNotFound(id);
      if (await this.categories.hasLiveChildren(tx, scope, id)) {
        throw new CodedConflictException(
          'CATEGORY_HAS_CHILDREN',
          'Move or delete the subcategories first',
          { id },
        );
      }
      await this.categories.softDelete(tx, scope, id);
    });
  }

  /**
   * `movingId` null means a new category (height 1). Call with the tree lock
   * held: the checks read the tree and are only valid until someone else writes it.
   */
  private async assertPlacement(
    tx: Transaction,
    scope: TenantScope,
    movingId: string | null,
    parentId: string,
  ): Promise<void> {
    if (!(await this.categories.findLive(tx, scope, parentId))) throw categoryNotFound(parentId);

    const chain = await this.categories.chainToRoot(tx, scope, parentId);
    if (movingId !== null && chain.includes(movingId)) {
      throw new CodedConflictException(
        'CATEGORY_CYCLE',
        'A category cannot be placed under itself or one of its descendants',
      );
    }

    const height = movingId === null ? 1 : await this.categories.subtreeHeight(tx, scope, movingId);
    if (chain.length + height > CATEGORY_MAX_DEPTH) {
      throw new CodedConflictException('CATEGORY_TOO_DEEP', 'Categories nest too deep', {
        max: CATEGORY_MAX_DEPTH,
      });
    }
  }
}
