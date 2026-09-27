export interface PutOptions {
  contentType: string;
  cacheControl: string;
}

export interface StoredObject {
  key: string;
  lastModified: Date;
}

export interface ObjectPage {
  objects: StoredObject[];
  /** Pass back to list() for the next page; null on the last one. */
  nextCursor: string | null;
}

/**
 * The only object-storage surface the rest of the API sees, and its DI token.
 * S3ObjectStorage backs it in the app; InMemoryObjectStorage in tests. Nothing
 * outside modules/storage imports @aws-sdk/*.
 *
 * Every method that talks to the store throws CodedServiceUnavailableException
 * (STORAGE_UNAVAILABLE) on failure.
 */
export abstract class ObjectStorage {
  abstract put(key: string, body: Buffer, options: PutOptions): Promise<void>;
  abstract delete(key: string): Promise<void>;
  abstract list(prefix: string, cursor?: string | null): Promise<ObjectPage>;
  abstract publicUrl(key: string): string;
}

/** Joins with exactly one slash, whether or not the configured base ends in one. */
export function joinPublicUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, '')}/${key}`;
}
