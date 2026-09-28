import {
  CodedBadRequestException,
  CodedConflictException,
  CodedNotFoundException,
  CodedServiceUnavailableException,
} from '../../../common/errors/index';

export const messengerNotConfigured = () =>
  new CodedServiceUnavailableException(
    'MESSENGER_NOT_CONFIGURED',
    'Facebook app credentials are not configured',
  );

export const facebookAuthCancelled = () =>
  new CodedBadRequestException('FACEBOOK_AUTH_CANCELLED', 'Facebook authorization was cancelled');

/** No flow cookie, an expired one, or one from another session: start again. */
export const facebookAuthExpired = () =>
  new CodedBadRequestException(
    'FACEBOOK_AUTH_EXPIRED',
    'The Facebook connection expired; start again',
  );

export const facebookAuthFailed = () =>
  new CodedBadRequestException('FACEBOOK_AUTH_FAILED', 'Facebook authorization failed');

export const facebookPermissionsDeclined = (missing: string[]) =>
  new CodedBadRequestException(
    'FACEBOOK_PERMISSIONS_DECLINED',
    'Required Facebook permissions were not granted',
    { permissions: missing.join(', ') },
  );

export const facebookUnavailable = () =>
  new CodedServiceUnavailableException('FACEBOOK_UNAVAILABLE', 'Facebook could not be reached');

export const facebookPageNotFound = (pageId: string) =>
  new CodedNotFoundException(
    'FACEBOOK_PAGE_NOT_FOUND',
    'That Page is not one you granted access to',
    { pageId },
  );

export const facebookPageNoMessagingAccess = (pageId: string) =>
  new CodedBadRequestException(
    'FACEBOOK_PAGE_NO_MESSAGING_ACCESS',
    'Your role on this Page does not include messaging',
    { pageId },
  );

/** Another shop has it. Says nothing about which one. */
export const facebookPageTaken = (pageId: string) =>
  new CodedConflictException('FACEBOOK_PAGE_TAKEN', 'This Page is connected to another shop', {
    pageId,
  });

export const facebookPageAlreadyConnected = () =>
  new CodedConflictException(
    'FACEBOOK_PAGE_ALREADY_CONNECTED',
    'This shop already has a Page connected; disconnect it first',
  );
