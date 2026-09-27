import { eq, isNull, type SQL } from 'drizzle-orm';
import { product, productVariant } from '../../database/schema/index.js';

/**
 * Every read of `product_variant` adds liveVariant(): Drizzle has no automatic
 * soft-delete filter, and a read that forgets it lets the AI offer a variant
 * the seller archived. Category reads use categories/category-visibility.ts.
 */
export const liveVariant = (): SQL => isNull(productVariant.archivedAt);
/** What the AI may offer. Dashboard reads show every status. */
export const sellableProduct = (): SQL => eq(product.status, 'active');
