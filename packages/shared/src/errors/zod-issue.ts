import type { core } from 'zod';
import { isErrorCode, type ErrorCode } from './codes.js';
import type { ErrorParams } from './envelope.js';

/**
 * Turns one Zod issue into the code and params the envelope carries.
 *
 * Shared because both sides need the same answer: the API puts it on the wire
 * in a VALIDATION_FAILED `fields` map, and the SPA's forms run the same shared
 * schemas client-side and must show the same sentence for the same failure.
 *
 * Zod issues already carry the raw constraint argument - `too_small` has
 * `minimum`, `invalid_format` has `format` - so the code and its interpolation
 * params come straight off the issue. Takes a raw issue too, which is what an
 * error map is handed during a parse.
 */
export function describeZodIssue(issue: core.$ZodIssue | core.$ZodRawIssue): {
  code: ErrorCode;
  params: ErrorParams;
} {
  switch (issue.code) {
    case 'invalid_type':
      // A missing key and an explicit undefined are both "you have to send this".
      return issue.input === undefined || issue.expected === 'nonoptional'
        ? { code: 'REQUIRED', params: {} }
        : { code: 'INVALID_TYPE', params: { expected: issue.expected } };

    case 'too_small':
      // `.min(1)` on a string is how a schema says "not blank"; "use at least
      // 1 characters" is not a sentence anyone should read.
      if (issue.origin === 'string' && Number(issue.minimum) === 1) {
        return { code: 'REQUIRED', params: {} };
      }
      return { code: sizeCode(issue.origin, 'min'), params: { min: toParam(issue.minimum) } };

    case 'too_big':
      return { code: sizeCode(issue.origin, 'max'), params: { max: toParam(issue.maximum) } };

    case 'invalid_format':
      return { code: 'INVALID_FORMAT', params: { format: issue.format } };

    case 'not_multiple_of':
      return { code: 'NOT_MULTIPLE_OF', params: { divisor: toParam(issue.divisor) } };

    case 'unrecognized_keys':
      return { code: 'UNRECOGNIZED_KEYS', params: { keys: issue.keys.join(', ') } };

    case 'invalid_value':
      return { code: 'INVALID_VALUE', params: { values: issue.values.map(String).join(', ') } };

    case 'custom': {
      // A refinement names its own code: `.refine(fn, { params: { code: 'INVALID_PHONE' } })`.
      const code: unknown = issue.params?.code;
      return typeof code === 'string' && isErrorCode(code)
        ? { code, params: {} }
        : { code: 'INVALID_INPUT', params: {} };
    }

    default:
      // invalid_union, invalid_key, invalid_element, and whatever a later Zod
      // adds: degrade to a usable code rather than fail the request.
      return { code: 'INVALID_INPUT', params: {} };
  }
}

/** Zod reports bounds as number | bigint; params must stay JSON-safe. */
function toParam(value: number | bigint): string | number {
  return typeof value === 'bigint' ? value.toString() : value;
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
