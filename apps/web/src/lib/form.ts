import { zodResolver } from '@hookform/resolvers/zod';
import { describeZodIssue } from '@app/shared';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import type { z } from 'zod';

import { useErrorMessages } from '@/i18n/error-keys';
import { ApiError } from '@/lib/api-error';

/**
 * zodResolver for a shared schema, with every client-side failure worded
 * exactly as the API would word it: each issue goes through the same
 * describeZodIssue the API uses, then through the errors catalog. A message a
 * schema sets itself still wins, so a form-only field can carry its own copy.
 */
export function useZodResolver<Input extends FieldValues, Output>(
  schema: z.ZodType<Output, Input>,
) {
  const { forField } = useErrorMessages();

  return zodResolver(schema, {
    error: (issue) => forField({ ...describeZodIssue(issue), message: '' }),
  });
}

/**
 * Puts a VALIDATION_FAILED response's field errors on the controls they name.
 * Returns whether any landed, so the caller knows the banner is not the only
 * place the seller will see what went wrong.
 */
export function applyServerFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fieldNames: readonly Path<T>[],
  forField: ReturnType<typeof useErrorMessages>['forField'],
): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }

  let applied = false;
  for (const name of fieldNames) {
    const [first] = error.fieldErrors(name);
    if (first) {
      setError(name, { type: 'server', message: forField(first) }, { shouldFocus: !applied });
      applied = true;
    }
  }
  return applied;
}
