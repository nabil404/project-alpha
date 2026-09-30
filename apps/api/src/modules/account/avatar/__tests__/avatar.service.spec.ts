import { HttpException } from '@nestjs/common';
import sharp from 'sharp';
import {
  InMemoryObjectStorage,
  TEST_PUBLIC_BASE_URL,
} from '../../../storage/__tests__/in-memory-object-storage';
import { AvatarService } from '../avatar.service';
import type { UserImageRepository } from '../user-image.repository';

const USER = 'Ab3dEf9hIjKlMnOpQrStUvWxYz012345';

const jpeg = (width = 400, height = 400) =>
  sharp({ create: { width, height, channels: 3, background: '#48c' } })
    .jpeg()
    .toBuffer();

/** user.image in memory, with a switch to make the swap fail. */
class FakeUserImages {
  image: string | null = null;
  fail = false;

  async swapImage(_userId: string, image: string | null): Promise<string | null> {
    if (this.fail) throw new Error('database down');
    const previous = this.image;
    this.image = image;
    return previous;
  }
}

async function codeOf(promise: Promise<unknown>): Promise<{ status: number; code: unknown }> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to reject');
    },
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof HttpException)) throw error;
  return { status: error.getStatus(), code: (error.getResponse() as { code?: unknown }).code };
}

describe('AvatarService', () => {
  let storage: InMemoryObjectStorage;
  let users: FakeUserImages;
  let service: AvatarService;

  beforeEach(() => {
    storage = new InMemoryObjectStorage();
    users = new FakeUserImages();
    service = new AvatarService(users as unknown as UserImageRepository, storage);
  });

  it('stores the photo under the user and points user.image at it', async () => {
    const { image } = await service.upload(USER, await jpeg());

    expect(image).toMatch(
      new RegExp(`^${TEST_PUBLIC_BASE_URL}/u/${USER}/avatar/[0-9a-f-]{36}\\.jpg$`),
    );
    expect(users.image).toBe(image);
    expect([...storage.objects.keys()]).toHaveLength(1);
    const [stored] = storage.objects.values();
    expect(stored?.options.cacheControl).toBe('public, max-age=31536000, immutable');
  });

  it('deletes the photo it replaces', async () => {
    const first = await service.upload(USER, await jpeg());
    const second = await service.upload(USER, await jpeg());

    expect(second.image).not.toBe(first.image);
    expect([...storage.objects.keys()]).toHaveLength(1);
  });

  it('clears a Google photo without touching the bucket', async () => {
    users.image = 'https://lh3.googleusercontent.com/a/photo';
    storage.seed('m/shop/keep.jpg', new Date());

    expect(await service.remove(USER)).toEqual({ image: null });
    expect(users.image).toBeNull();
    expect(storage.objects.has('m/shop/keep.jpg')).toBe(true);
  });

  it('removes our own photo and its object', async () => {
    await service.upload(USER, await jpeg());

    expect(await service.remove(USER)).toEqual({ image: null });
    expect(storage.objects.size).toBe(0);
  });

  it('deletes the new object when user.image cannot be updated', async () => {
    users.fail = true;

    await expect(service.upload(USER, await jpeg())).rejects.toThrow('database down');
    expect(storage.objects.size).toBe(0);
  });

  it('keeps the new photo when the old object will not delete', async () => {
    const first = await service.upload(USER, await jpeg());
    storage.failDelete = () => true;

    const second = await service.upload(USER, await jpeg());

    expect(users.image).toBe(second.image);
    expect(storage.objects.size).toBe(2);
    expect(first.image).not.toBe(second.image);
  });

  it.each([
    ['too small', () => jpeg(100, 100), 400, 'AVATAR_TOO_SMALL'],
    ['not an image', async () => Buffer.from('nope'), 400, 'AVATAR_INVALID'],
    [
      'a GIF',
      () =>
        sharp({ create: { width: 300, height: 300, channels: 3, background: '#000' } })
          .gif()
          .toBuffer(),
      415,
      'AVATAR_UNSUPPORTED_TYPE',
    ],
  ])('refuses %s', async (_label, file, status, code) => {
    expect(await codeOf(service.upload(USER, await file()))).toEqual({ status, code });
    expect(storage.objects.size).toBe(0);
  });
});
