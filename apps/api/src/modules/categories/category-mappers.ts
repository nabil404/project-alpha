import type { Category } from '@app/shared';
import type { CategoryRow } from './categories.repository.js';

export function toCategory(row: CategoryRow): Category {
  return { id: row.id, name: row.name, parentId: row.parentId };
}
