import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';

import { ForgotPasswordForm, ResetLinkSentNotice } from '@/features/auth';

export const Route = createFileRoute('/_auth/forgot-password')({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string>();

  return sentTo ? (
    <ResetLinkSentNotice email={sentTo} />
  ) : (
    <ForgotPasswordForm onSent={setSentTo} />
  );
}
