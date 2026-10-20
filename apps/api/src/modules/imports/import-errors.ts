import {
  CodedConflictException,
  CodedNotFoundException,
  CodedServiceUnavailableException,
  CodedValidationException,
} from '../../common/errors/index';

export const importNotFound = (id: string) =>
  new CodedNotFoundException('IMPORT_NOT_FOUND', 'Import not found', { id });

/** The shop already has a queued, running or stopping run. */
export const importAlreadyRunning = () =>
  new CodedConflictException('IMPORT_ALREADY_RUNNING', 'Another import is already running');

export const importNotRunning = (id: string) =>
  new CodedConflictException('IMPORT_NOT_RUNNING', 'The import is not running', { id });

export const importNotStopped = (id: string) =>
  new CodedConflictException('IMPORT_NOT_STOPPED', 'Only a stopped import can be resumed', {
    id,
  });

export const importPostNotFound = (id: string) =>
  new CodedNotFoundException('IMPORT_POST_NOT_FOUND', 'Imported post not found', { id });

/** Import anyway is only for a post skipped as not a product or already in the catalog. */
export const importPostNotSkipped = (id: string) =>
  new CodedConflictException('IMPORT_POST_NOT_SKIPPED', 'The post was not skipped', { id });

/** No LLM or no Graph client is configured, so no post can be read. */
export const importNotAvailable = () =>
  new CodedServiceUnavailableException(
    'IMPORT_NOT_AVAILABLE',
    'Importing from Facebook is not available right now',
  );

/** `until` is after the shop's today. */
export const importUntilInFuture = (today: string) =>
  new CodedValidationException({
    until: [{ code: 'MAX_VALUE', message: 'Must not be after today', params: { max: today } }],
  });
