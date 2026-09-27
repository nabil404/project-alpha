import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';

import { SignUpForm, VerifyEmailNotice, type SignUpDraft } from '@/features/auth';

export const Route = createFileRoute('/_auth/sign-up')({
  component: SignUpPage,
});

function SignUpPage() {
  // The draft outlives the form, so "Go back and change it" returns to a
  // filled-in form with only the password to type again.
  const [draft, setDraft] = useState<SignUpDraft>();
  const [sentTo, setSentTo] = useState<string>();

  if (sentTo) {
    return <VerifyEmailNotice email={sentTo} onChangeEmail={() => setSentTo(undefined)} />;
  }

  return (
    <SignUpForm
      defaultValues={draft}
      onSignedUp={({ password: _, ...rest }) => {
        setDraft(rest);
        setSentTo(rest.email);
      }}
    />
  );
}
