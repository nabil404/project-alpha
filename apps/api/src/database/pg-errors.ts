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
