import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';

import { InvalidResetLinkNotice, PasswordUpdatedNotice, ResetPasswordForm } from '@/features/auth';

interface ResetPasswordSearch {
  /** The single-use token Better Auth appends to the emailed link. */
  token?: string;
  /** `INVALID_TOKEN` when Better Auth rejected the link before it got here. */
  error?: string;
}

export const Route = createFileRoute('/_auth/reset-password')({
  validateSearch: (search: Record<string, unknown>): ResetPasswordSearch => ({
    token: typeof search.token === 'string' && search.token !== '' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token, error } = Route.useSearch();
  const [done, setDone] = useState(false);

  if (done) {
    return <PasswordUpdatedNotice />;
  }
  if (!token || error) {
    return <InvalidResetLinkNotice />;
  }
  return <ResetPasswordForm token={token} onReset={() => setDone(true)} />;
}
