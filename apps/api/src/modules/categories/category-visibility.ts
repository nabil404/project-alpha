import { isNull, type SQL } from 'drizzle-orm';
import { category } from '../../database/schema/index';

/**
 * Drizzle has no automatic soft-delete filter (TypeORM's @DeleteDateColumn
 * did this in tiny-threads), so every read of `category` - here and in the
 * products module's junction joins - adds this predicate. A read that forgets
 * it lets the AI offer a category the seller deleted.
 */
export const liveCategory = (): SQL => isNull(category.deletedAt);
