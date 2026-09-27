import { CodedServiceUnavailableException } from '../../../common/errors/coded-exceptions';
import { joinPublicUrl, ObjectStorage, type ObjectPage, type PutOptions } from '../object-storage';

export const TEST_PUBLIC_BASE_URL = 'https://media.example.test';

const unavailable = () =>
  new CodedServiceUnavailableException('STORAGE_UNAVAILABLE', 'Object storage is unavailable');

/** A bucket in a Map, with switches to make individual calls fail. */
export class InMemoryObjectStorage extends ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; options: PutOptions; lastModified: Date }>();
  failPut: (key: string) => boolean = () => false;
  failDelete: (key: string) => boolean = () => false;
  now: () => Date = () => new Date();
  pageSize = 1000;

  async put(key: string, body: Buffer, options: PutOptions): Promise<void> {
    if (this.failPut(key)) {
      throw unavailable();
    }
    this.objects.set(key, { body, options, lastModified: this.now() });
  }

  async delete(key: string): Promise<void> {
    if (this.failDelete(key)) {
      throw unavailable();
    }
    this.objects.delete(key);
  }

  async list(prefix: string, cursor: string | null = null): Promise<ObjectPage> {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = cursor === null ? 0 : Number(cursor);
    const end = start + this.pageSize;
    return {
      objects: keys.slice(start, end).map((key) => ({
        key,
        lastModified: this.objects.get(key)?.lastModified ?? new Date(0),
      })),
      nextCursor: end < keys.length ? String(end) : null,
    };
  }

  publicUrl(key: string): string {
    return joinPublicUrl(TEST_PUBLIC_BASE_URL, key);
  }

  /** Places an object with a chosen age, for cleanup tests. */
  seed(key: string, lastModified: Date): void {
    this.objects.set(key, {
      body: Buffer.alloc(0),
      options: { contentType: 'image/jpeg', cacheControl: '' },
      lastModified,
    });
  }
}
