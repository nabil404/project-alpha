import { createFileRoute } from '@tanstack/react-router';

import { safeRedirect, SignInForm } from '@/features/auth';
import { useErrorMessages } from '@/i18n/error-keys';

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

/** Better Auth's redirect error values for a dead email link. */
const tokenErrors: ReadonlySet<string> = new Set(['INVALID_TOKEN', 'TOKEN_EXPIRED']);

function SignInPage() {
  const { redirect, error } = Route.useSearch();
  const { forCode } = useErrorMessages();

  // A failed Google/Facebook sign-in arrives already coded by the API; an
  // unknown value reads as the generic message.
  const initialError = error
    ? forCode(tokenErrors.has(error) ? 'AUTH_INVALID_TOKEN' : error)
    : undefined;

  return <SignInForm redirectTo={redirect ?? '/'} initialError={initialError} />;
}
