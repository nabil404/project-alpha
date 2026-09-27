import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { safeRedirect, SignInForm } from '@/features/auth';
import { errorCodeKeys } from '@/i18n/error-keys';

interface SignInSearch {
  /** Where to go once signed in; a same-origin path only. */
  redirect?: string;
  /** Set by a failed emailed link, or by Better Auth when a Google/Facebook sign-in fails. */
  error?: string;
}

export const Route = createFileRoute('/_auth/sign-in')({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    redirect: safeRedirect(search.redirect),
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: SignInPage,
});

/** Better Auth's redirect error values for a dead email link; anything else reads as generic. */
const tokenErrors: ReadonlySet<string> = new Set(['INVALID_TOKEN', 'TOKEN_EXPIRED']);

function SignInPage() {
  const { redirect, error } = Route.useSearch();
  const { t } = useTranslation('errors');

  const initialError = error
    ? tokenErrors.has(error)
      ? t(errorCodeKeys.AUTH_INVALID_TOKEN)
      : t('generic')
    : undefined;

  return <SignInForm redirectTo={redirect ?? '/'} initialError={initialError} />;
}
