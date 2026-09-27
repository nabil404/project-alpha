import { CodedConflictException, CodedNotFoundException } from '../../common/errors/index';
import { uniqueViolationConstraint } from '../../database/pg-errors';
import { CATEGORY_NAME_LIVE_UIDX } from '../../database/schema/index';

export const categoryNotFound = (id?: string) =>
  new CodedNotFoundException('CATEGORY_NOT_FOUND', 'Category not found', id ? { id } : {});

/**
 * Maps the live-name unique index to CATEGORY_NAME_TAKEN. The index decides,
 * not a pre-check, so two racing requests cannot both take the name. The
 * violation aborts the transaction; rethrowing lets withMerchant roll it back.
 */
export async function guardCategoryName<T>(
  name: string | undefined,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (name !== undefined && uniqueViolationConstraint(error) === CATEGORY_NAME_LIVE_UIDX) {
      throw new CodedConflictException(
        'CATEGORY_NAME_TAKEN',
        'A category with this name already exists',
        {
          name,
        },
      );
    }
    throw error;
  }
}
