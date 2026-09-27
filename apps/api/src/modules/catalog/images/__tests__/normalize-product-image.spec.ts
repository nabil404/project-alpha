import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import sharp from 'sharp';
import {
  normalizeProductImage,
  type NormalizedImage,
  type NormalizeResult,
} from '../normalize-product-image.js';

/** Inputs are generated here rather than committed as binary fixtures. */
const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } });

function ok(result: NormalizeResult): NormalizedImage {
  if (!result.ok) {
    throw new Error(`expected a normalized image, got '${result.reason}'`);
  }
  return result;
}

describe('normalizeProductImage', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('drops EXIF from both outputs', async () => {
    const input = await solid(64, 64)
      .withExif({ IFD0: { Artist: 'Seller', Copyright: 'Home studio' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const result = ok(await normalizeProductImage(input));

    for (const output of [result.full, result.thumbnail]) {
      const metadata = await sharp(output).metadata();
      expect(metadata.format).toBe('jpeg');
      expect(metadata.exif).toBeUndefined();
    }
  });

  it('applies EXIF orientation before dropping it, so the photo is upright', async () => {
    const input = await solid(200, 100).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);

    const result = ok(await normalizeProductImage(input));

    expect([result.width, result.height]).toEqual([100, 200]);
    const metadata = await sharp(result.full).metadata();
    expect([metadata.width, metadata.height]).toEqual([100, 200]);
    expect(metadata.orientation).toBeUndefined();
  });

  it('puts transparent pixels on white', async () => {
    const input = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();

    const result = ok(await normalizeProductImage(input));

    const { data, info } = await sharp(result.full).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    expect(Math.min(...data)).toBeGreaterThanOrEqual(250);
  });

  it('fits the full image in 2048 and the thumbnail in 400, keeping the aspect ratio', async () => {
    const input = await solid(4000, 3000).jpeg().toBuffer();

    const result = ok(await normalizeProductImage(input));

    expect([result.width, result.height]).toEqual([2048, 1536]);
    expect(result.byteSize).toBe(result.full.length);
    const thumbnail = await sharp(result.thumbnail).metadata();
    expect([thumbnail.width, thumbnail.height]).toEqual([400, 300]);
  });

  it('never enlarges a small image', async () => {
    const input = await solid(300, 200).png().toBuffer();

    const result = ok(await normalizeProductImage(input));

    expect([result.width, result.height]).toEqual([300, 200]);
    const thumbnail = await sharp(result.thumbnail).metadata();
    expect([thumbnail.width, thumbnail.height]).toEqual([300, 200]);
  });

  it('converts a CMYK JPEG to a three-channel sRGB JPEG', async () => {
    const input = await solid(32, 32).toColourspace('cmyk').jpeg().toBuffer();
    expect((await sharp(input).metadata()).space).toBe('cmyk');

    const result = ok(await normalizeProductImage(input));

    const metadata = await sharp(result.full).metadata();
    expect(metadata.space).toBe('srgb');
    expect(metadata.channels).toBe(3);
  });

  it('accepts WebP', async () => {
    const input = await solid(16, 16).webp().toBuffer();
    expect((await normalizeProductImage(input)).ok).toBe(true);
  });

  it('rejects an image over the pixel limit as invalid', async () => {
    const input = await solid(300, 200).png().toBuffer();
    await expect(normalizeProductImage(input, { maxInputPixels: 50_000 })).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects bytes that are not an image as invalid', async () => {
    await expect(normalizeProductImage(Buffer.from('not an image'))).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('logs why an image was rejected as invalid', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    try {
      const result = await normalizeProductImage(Buffer.from('not an image'));

      expect(result).toEqual({ ok: false, reason: 'invalid' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Rejected image as invalid'));
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects a truncated JPEG as invalid rather than returning a partial image', async () => {
    const whole = await solid(256, 256).jpeg().toBuffer();
    const truncated = whole.subarray(0, Math.floor(whole.length / 2));

    await expect(normalizeProductImage(truncated)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a GIF as unsupported', async () => {
    const input = await solid(8, 8).gif().toBuffer();
    await expect(normalizeProductImage(input)).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  // AVIF shares the HEIF container with iPhone HEIC photos; sharp reports both as 'heif'.
  it('rejects a HEIF-family image as unsupported', async () => {
    const input = await solid(8, 8).avif().toBuffer();
    await expect(normalizeProductImage(input)).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });
});
