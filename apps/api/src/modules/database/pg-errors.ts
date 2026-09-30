/** Postgres SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = '23505';

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

/**
 * The constraint a unique violation hit, or null for any other error. Drizzle
 * wraps driver errors in DrizzleQueryError with the pg error on `cause`, so
 * this walks the cause chain instead of reading the top-level error.
 */
export function uniqueViolationConstraint(error: unknown): string | null {
  let current: unknown = error;
  for (let hop = 0; hop < 5 && typeof current === 'object' && current !== null; hop++) {
    const candidate = current as PgErrorLike;
    if (candidate.code === UNIQUE_VIOLATION) {
      return typeof candidate.constraint === 'string' ? candidate.constraint : null;
    }
    current = candidate.cause;
  }
  return null;
}

/** Postgres SQLSTATE for foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = '23503';

/** Whether a query failed because a row still references the one it changed. Walks the cause chain as above. */
export function isForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let hop = 0; hop < 5 && typeof current === 'object' && current !== null; hop++) {
    if ((current as PgErrorLike).code === FOREIGN_KEY_VIOLATION) return true;
    current = (current as PgErrorLike).cause;
  }
  return false;
}
