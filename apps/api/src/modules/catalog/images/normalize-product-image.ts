import sharp from 'sharp';

export interface NormalizeLimits {
  /** Refuse inputs above this many pixels before decoding them fully. */
  maxInputPixels: number;
}

export const DEFAULT_NORMALIZE_LIMITS: NormalizeLimits = { maxInputPixels: 40_000_000 };

export interface NormalizedImage {
  ok: true;
  full: Buffer;
  thumbnail: Buffer;
  /** Of the full image. */
  width: number;
  height: number;
  byteSize: number;
}

export type NormalizeResult = NormalizedImage | { ok: false; reason: 'unsupported' | 'invalid' };

const ACCEPTED_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp']);
const FULL_MAX = 2048;
const THUMBNAIL_MAX = 400;
const WHITE = { r: 255, g: 255, b: 255 };

const invalid: NormalizeResult = { ok: false, reason: 'invalid' };
const unsupported: NormalizeResult = { ok: false, reason: 'unsupported' };

/**
 * Turns a seller's upload into the two JPEGs we publish. The output is public
 * and goes to customers through Meta, so nothing of the input survives but the
 * pixels: EXIF (GPS location included), XMP and ICC are all dropped - sharp
 * writes no metadata unless asked to. Orientation is applied first, or phone
 * photos would come out sideways once the tag is gone.
 *
 * The format comes from sharp's own detection, never the client's MIME type.
 */
export async function normalizeProductImage(
  input: Buffer,
  limits: NormalizeLimits = DEFAULT_NORMALIZE_LIMITS,
): Promise<NormalizeResult> {
  let format: string | undefined;
  let width: number | undefined;
  let height: number | undefined;
  try {
    ({ format, width, height } = await sharp(input).metadata());
  } catch {
    return invalid;
  }

  if (!format) {
    return invalid;
  }
  if (!ACCEPTED_FORMATS.has(format)) {
    return unsupported;
  }
  if (!width || !height || width * height > limits.maxInputPixels) {
    return invalid;
  }

  try {
    const base = sharp(input, { limitInputPixels: limits.maxInputPixels, failOn: 'truncated' })
      .rotate()
      .flatten({ background: WHITE });

    const full = await base
      .clone()
      .resize({ width: FULL_MAX, height: FULL_MAX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    const thumbnail = await base
      .clone()
      .resize({
        width: THUMBNAIL_MAX,
        height: THUMBNAIL_MAX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 75, mozjpeg: true })
      .toBuffer();

    return {
      ok: true,
      full: full.data,
      thumbnail,
      width: full.info.width,
      height: full.info.height,
      byteSize: full.data.length,
    };
  } catch {
    return invalid;
  }
}
