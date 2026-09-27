import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { CodedServiceUnavailableException } from '../../common/errors/coded-exceptions.js';
import {
  joinPublicUrl,
  ObjectStorage,
  type ObjectPage,
  type PutOptions,
} from './object-storage.js';

type S3Sender = Pick<S3Client, 'send'>;

/** ObjectStorage over any S3-compatible API. Takes a sender so tests need no network. */
export class S3ObjectStorage extends ObjectStorage {
  private readonly logger = new Logger(S3ObjectStorage.name);

  constructor(
    private readonly client: S3Sender,
    private readonly bucket: string,
    private readonly publicBaseUrl: string,
  ) {
    super();
  }

  async put(key: string, body: Buffer, { contentType, cacheControl }: PutOptions): Promise<void> {
    await this.run('put', () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: cacheControl,
          ContentLength: body.length,
        }),
      ),
    );
  }

  async delete(key: string): Promise<void> {
    await this.run('delete', () =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
    );
  }

  async list(prefix: string, cursor: string | null = null): Promise<ObjectPage> {
    const page = await this.run('list', () =>
      this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: cursor ?? undefined,
          MaxKeys: 1000,
        }),
      ),
    );

    return {
      objects: (page.Contents ?? []).flatMap((object) =>
        object.Key && object.LastModified
          ? [{ key: object.Key, lastModified: object.LastModified }]
          : [],
      ),
      nextCursor: page.IsTruncated ? (page.NextContinuationToken ?? null) : null,
    };
  }

  publicUrl(key: string): string {
    return joinPublicUrl(this.publicBaseUrl, key);
  }

  /**
   * SDK errors can carry request details, so only the operation, the error
   * name, the HTTP status and an error code are logged - never
   * `error.message`, which can echo back request content such as a key.
   */
  private async run<T>(operation: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      const status =
        error && typeof error === 'object' && '$metadata' in error
          ? (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode
          : undefined;
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;

      const details = [
        typeof status === 'number' ? `status ${status}` : undefined,
        typeof code === 'string' ? `code ${code}` : undefined,
      ].filter((detail): detail is string => detail !== undefined);

      this.logger.warn(
        `Object storage ${operation} failed: ${name}${details.length > 0 ? ` (${details.join(', ')})` : ''}`,
      );
      throw new CodedServiceUnavailableException(
        'STORAGE_UNAVAILABLE',
        'Object storage is unavailable',
      );
    }
  }
}
