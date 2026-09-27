import type { core } from 'zod';
import { describeZodIssue, ROOT_FIELD, type FieldError } from '@app/shared';

/**
 * Turns Zod issues into the envelope's `fields` map.
 *
 * The code and params for each issue come from describeZodIssue in
 * @app/shared, which the SPA's forms use too, so a rule broken client-side and
 * the same rule broken server-side read as the same sentence.
 */

/**
 * `path` is PropertyKey[], and Array#join throws outright on a symbol key, so
 * every segment is stringified first. An empty path is an issue about the body
 * as a whole rather than about one property.
 */
function fieldKey(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return ROOT_FIELD;
  }

  return path
    .map((segment) =>
      typeof segment === 'symbol' ? (segment.description ?? 'symbol') : String(segment),
    )
    .join('.');
}

export function zodIssuesToFields(issues: readonly core.$ZodIssue[]): Record<string, FieldError[]> {
  const fields: Record<string, FieldError[]> = {};

  for (const issue of issues) {
    const { code, params } = describeZodIssue(issue);
    // Zod has already interpolated issue.message; it is the English fallback.
    (fields[fieldKey(issue.path)] ??= []).push({ code, message: issue.message, params });
  }

  return fields;
}
