import { z } from 'zod';

/** A keyset position: the sort timestamp and the id that breaks ties. */
export interface CursorKey {
  at: Date;
  id: string;
}

const cursorSchema = z.object({ at: z.string().datetime(), id: z.string().uuid() });

/**
 * Opaque to clients. The columns it points into are millisecond-precision
 * (`timestamp(3)`), so a key that round-trips through a JS Date loses nothing.
 */
export function encodeCursor({ at, id }: CursorKey): string {
  return Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString('base64url');
}

/** Null for anything this API did not issue. */
export function decodeCursor(value: string): CursorKey | null {
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    return parsed.success ? { at: new Date(parsed.data.at), id: parsed.data.id } : null;
  } catch {
    return null;
  }
}
