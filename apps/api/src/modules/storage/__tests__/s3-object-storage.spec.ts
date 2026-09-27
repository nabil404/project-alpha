import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { HttpException, Logger } from '@nestjs/common';
import { S3ObjectStorage } from '../s3-object-storage.js';

/** Stands in for S3Client: records each command and answers with `respond`. */
class FakeSender {
  readonly commands: unknown[] = [];

  constructor(private readonly respond: (command: unknown) => unknown = () => ({})) {}

  async send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    return this.respond(command);
  }
}

const storageWith = (sender: FakeSender, publicBase = 'https://media.example.com') =>
  new S3ObjectStorage(sender as unknown as Pick<S3Client, 'send'>, 'bucket-a', publicBase);

describe('S3ObjectStorage', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('puts an object with its content type, cache policy and length', async () => {
    const sender = new FakeSender();
    const body = Buffer.from('jpeg-bytes');

    await storageWith(sender).put('m/abc/1.jpg', body, {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    });

    const [command] = sender.commands;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: 'bucket-a',
      Key: 'm/abc/1.jpg',
      Body: body,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
      ContentLength: body.length,
    });
  });

  it('deletes by key in the configured bucket', async () => {
    const sender = new FakeSender();
    await storageWith(sender).delete('m/abc/1.jpg');

    const [command] = sender.commands;
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect((command as DeleteObjectCommand).input).toEqual({
      Bucket: 'bucket-a',
      Key: 'm/abc/1.jpg',
    });
  });

  it('maps a listing page and hands back the continuation token while truncated', async () => {
    const modified = new Date('2026-09-01T00:00:00Z');
    const sender = new FakeSender(() => ({
      Contents: [{ Key: 'm/a/1.jpg', LastModified: modified }, { LastModified: modified }],
      IsTruncated: true,
      NextContinuationToken: 'next-token',
    }));

    const page = await storageWith(sender).list('m/', 'prev-token');

    expect(page).toEqual({
      objects: [{ key: 'm/a/1.jpg', lastModified: modified }],
      nextCursor: 'next-token',
    });
    const [command] = sender.commands;
    expect(command).toBeInstanceOf(ListObjectsV2Command);
    expect((command as ListObjectsV2Command).input).toMatchObject({
      Bucket: 'bucket-a',
      Prefix: 'm/',
      ContinuationToken: 'prev-token',
    });
  });

  it('ends the listing when the page is not truncated', async () => {
    const sender = new FakeSender(() => ({ Contents: [], IsTruncated: false }));
    await expect(storageWith(sender).list('m/')).resolves.toEqual({
      objects: [],
      nextCursor: null,
    });
  });

  it('turns an SDK failure into STORAGE_UNAVAILABLE', async () => {
    const sender = new FakeSender(() => {
      throw Object.assign(new Error('AccessDenied for key-id'), { name: 'AccessDenied' });
    });

    const error = await storageWith(sender)
      .delete('m/a/1.jpg')
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });

  it.each(['https://media.example.com', 'https://media.example.com/'])(
    'builds public URLs with exactly one slash from %s',
    (base) => {
      expect(storageWith(new FakeSender(), base).publicUrl('m/a/1.jpg')).toBe(
        'https://media.example.com/m/a/1.jpg',
      );
    },
  );
});
