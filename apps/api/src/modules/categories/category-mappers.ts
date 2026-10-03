import type { Category, CategoryWithCount } from '@app/shared';
import type { CategoryRow } from './categories.repository';

export function toCategory(row: CategoryRow): Category {
  return { id: row.id, name: row.name };
}

export function toCategoryWithCount(row: CategoryRow, productCount: number): CategoryWithCount {
  return { ...toCategory(row), productCount };
}
