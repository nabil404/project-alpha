import { CodedConflictException, CodedNotFoundException } from '../../../common/errors/index';

export const adProductNotFound = (id: string) =>
  new CodedNotFoundException('AD_PRODUCT_NOT_FOUND', 'Ad not found', { id });

/** An archived product is gone from the shop; an ad would sell nothing. */
export const adProductArchived = (productId: string) =>
  new CodedConflictException(
    'AD_PRODUCT_ARCHIVED',
    'An archived product cannot be mapped to an ad',
    {
      productId,
    },
  );
