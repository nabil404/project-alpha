/**
 * The single row an insert/update `.returning()` must produce. An empty result
 * here is a bug (or a policy hiding the row), not a normal outcome, so it throws.
 */
export function one<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`${what} returned no row`);
  }
  return row;
}
