import {
  CodedBadRequestException,
  CodedConflictException,
  CodedNotFoundException,
} from '../../../common/errors/index';

export const productPostNotFound = (id: string) =>
  new CodedNotFoundException('PRODUCT_POST_NOT_FOUND', 'Post link not found', { id });

/** Not a link to a post on Facebook: another host, a profile, or a short link that led nowhere. */
export const productPostInvalidUrl = () =>
  new CodedBadRequestException('PRODUCT_POST_INVALID_URL', 'Not a link to a Facebook post');

/** One post sells one product: a shared post must name one. */
export const productPostTaken = (productId: string, productName: string) =>
  new CodedConflictException('PRODUCT_POST_TAKEN', 'The post is linked to another product', {
    productId,
    productName,
  });

/** An archived product is gone from the shop; a post would sell nothing. */
export const productPostArchived = (productId: string) =>
  new CodedConflictException(
    'PRODUCT_POST_ARCHIVED',
    'A post cannot be linked to an archived product',
    { productId },
  );

/** Graph refused for want of `pages_read_engagement` or a valid token: reconnect the Page. */
export const facebookPermissionMissing = (permission: string) =>
  new CodedConflictException(
    'FACEBOOK_PERMISSION_MISSING',
    'Reconnect the Facebook Page to grant the permission',
    { permission },
  );
