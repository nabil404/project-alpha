import { Logger } from '@nestjs/common';
import { AVATAR_MIN_SIDE } from '@app/shared';
import sharp from 'sharp';

const logger = new Logger('normalizeAvatar');

export const AVATAR_OUTPUT_SIDE = 512;

const ACCEPTED_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp']);
const WHITE = { r: 255, g: 255, b: 255 };

export type NormalizeAvatarResult =
  | { ok: true; image: Buffer }
  | { ok: false; reason: 'unsupported' | 'invalid' | 'too_small' };

const invalid: NormalizeAvatarResult = { ok: false, reason: 'invalid' };

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * A seller's photo, as the one square JPEG we publish. Nothing of the input
 * survives but the pixels: sharp writes no EXIF (GPS included), XMP or ICC
 * unless asked to. Orientation is applied first, or a phone photo would come
 * out sideways once the tag is gone. The format comes from sharp's own
 * detection, never the client's MIME type.
 */
export async function normalizeAvatar(
  input: Buffer,
  limits: { maxInputPixels: number } = { maxInputPixels: 40_000_000 },
): Promise<NormalizeAvatarResult> {
  let format: string | undefined;
  let width: number | undefined;
  let height: number | undefined;
  try {
    ({ format, width, height } = await sharp(input).metadata());
  } catch (error) {
    logger.warn(`Rejected avatar as invalid: ${describeError(error)}`);
    return invalid;
  }

  if (!format) {
    return invalid;
  }
  if (!ACCEPTED_FORMATS.has(format)) {
    return { ok: false, reason: 'unsupported' };
  }
  if (!width || !height || width * height > limits.maxInputPixels) {
    return invalid;
  }
  // The short side is the same before and after rotation.
  if (Math.min(width, height) < AVATAR_MIN_SIDE) {
    return { ok: false, reason: 'too_small' };
  }

  try {
    const image = await sharp(input, {
      limitInputPixels: limits.maxInputPixels,
      failOn: 'truncated',
    })
      .rotate()
      .flatten({ background: WHITE })
      .resize({ width: AVATAR_OUTPUT_SIDE, height: AVATAR_OUTPUT_SIDE, fit: 'cover' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { ok: true, image };
  } catch (error) {
    logger.warn(`Rejected avatar as invalid: ${describeError(error)}`);
    return invalid;
  }
}
