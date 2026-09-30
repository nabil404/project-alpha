import type { Category } from '@app/shared';
import type { CategoryRow } from './categories.repository';

export function toCategory(row: CategoryRow): Category {
  return { id: row.id, name: row.name };
}
