import type { core } from 'zod';
import { ROOT_FIELD, type ErrorCode, type ErrorParams, type FieldError } from '@app/shared';

/**
 * Turns Zod issues into the envelope's `fields` map.
 *
 * Zod issues already carry the raw constraint argument — `too_small` has
 * `minimum`, `invalid_format` has `format` — so the code and its interpolation
 * params come straight off the issue. Nothing has to be smuggled through a
 * decorator's message and decoded back out.
 */

/** Zod reports minimum/maximum as number | bigint; params must stay JSON-safe. */
function toParam(value: number | bigint): string | number {
  return typeof value === 'bigint' ? value.toString() : value;
}

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

/**
 * A size constraint means three different things to a reader depending on what
 * it was applied to, and they need three different sentences: characters for a
 * string, items for a collection, a bound for a number or date.
 */
const collectionOrigins: ReadonlySet<string> = new Set(['array', 'set', 'file']);

function sizeCode(origin: string, bound: 'min' | 'max'): ErrorCode {
  if (origin === 'string') {
    return bound === 'min' ? 'MIN_LENGTH' : 'MAX_LENGTH';
  }
  if (collectionOrigins.has(origin)) {
    return bound === 'min' ? 'MIN_ITEMS' : 'MAX_ITEMS';
  }
  return bound === 'min' ? 'MIN_VALUE' : 'MAX_VALUE';
}

function describe(issue: core.$ZodIssue): { code: ErrorCode; params: ErrorParams } {
  switch (issue.code) {
    case 'invalid_type':
      // A missing key and an explicit undefined are both "you have to send this".
      return issue.input === undefined || issue.expected === 'nonoptional'
        ? { code: 'REQUIRED', params: {} }
        : { code: 'INVALID_TYPE', params: { expected: issue.expected } };

    case 'too_small':
      return { code: sizeCode(issue.origin, 'min'), params: { min: toParam(issue.minimum) } };

    case 'too_big':
      return { code: sizeCode(issue.origin, 'max'), params: { max: toParam(issue.maximum) } };

    case 'invalid_format':
      return { code: 'INVALID_FORMAT', params: { format: issue.format } };

    case 'not_multiple_of':
      return { code: 'NOT_MULTIPLE_OF', params: { divisor: issue.divisor } };

    case 'unrecognized_keys':
      return { code: 'UNRECOGNIZED_KEYS', params: { keys: issue.keys.join(', ') } };

    case 'invalid_value':
      return { code: 'INVALID_VALUE', params: { values: issue.values.map(String).join(', ') } };

    default:
      // invalid_union, invalid_key, invalid_element, custom, and whatever a
      // later Zod adds: degrade to a usable code rather than fail the request.
      return { code: 'INVALID_INPUT', params: {} };
  }
}

export function zodIssuesToFields(issues: readonly core.$ZodIssue[]): Record<string, FieldError[]> {
  const fields: Record<string, FieldError[]> = {};

  for (const issue of issues) {
    const { code, params } = describe(issue);
    // Zod has already interpolated issue.message; it is the English fallback.
    (fields[fieldKey(issue.path)] ??= []).push({ code, message: issue.message, params });
  }

  return fields;
}
