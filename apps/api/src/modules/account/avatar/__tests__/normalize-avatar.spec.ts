import { AVATAR_MIN_SIDE } from '@app/shared';
import sharp from 'sharp';
import { AVATAR_OUTPUT_SIDE, normalizeAvatar } from '../normalize-avatar';

const image = (width: number, height: number, format: 'jpeg' | 'png' | 'webp' | 'gif' = 'jpeg') =>
  sharp({ create: { width, height, channels: 3, background: '#3a6' } })
    .toFormat(format)
    .toBuffer();

describe('normalizeAvatar', () => {
  it('center-crops to a 512px square JPEG', async () => {
    const result = await normalizeAvatar(await image(900, 600));

    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
    const meta = await sharp(result.image).metadata();
    expect(meta).toMatchObject({
      format: 'jpeg',
      width: AVATAR_OUTPUT_SIDE,
      height: AVATAR_OUTPUT_SIDE,
    });
  });

  it.each(['png', 'webp'] as const)('accepts %s', async (format) => {
    expect((await normalizeAvatar(await image(300, 300, format))).ok).toBe(true);
  });

  it('strips EXIF, GPS included', async () => {
    const tagged = await sharp(await image(400, 400))
      .withExif({ IFD0: { Copyright: 'Nadia' }, IFD3: { GPSLatitudeRef: 'N' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();

    const result = await normalizeAvatar(tagged);

    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
    expect((await sharp(result.image).metadata()).exif).toBeUndefined();
  });

  // Review Focus 1: the boundary is inclusive.
  it('accepts a short side of exactly the minimum and refuses one pixel less', async () => {
    expect((await normalizeAvatar(await image(AVATAR_MIN_SIDE, 800))).ok).toBe(true);
    expect(await normalizeAvatar(await image(800, AVATAR_MIN_SIDE - 1))).toEqual({
      ok: false,
      reason: 'too_small',
    });
  });

  it('refuses a format it does not accept', async () => {
    expect(await normalizeAvatar(await image(300, 300, 'gif'))).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('refuses bytes that are not an image', async () => {
    expect(await normalizeAvatar(Buffer.from('not an image'))).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  // Review Focus 2: refused from the header, before the pixels are decoded.
  it('refuses a canvas larger than the pixel limit', async () => {
    const bomb = await image(3000, 3000, 'png');
    expect(await normalizeAvatar(bomb, { maxInputPixels: 1_000_000 })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});
