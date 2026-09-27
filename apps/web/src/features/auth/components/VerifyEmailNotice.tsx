import { Mail } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';

import { useResendVerificationEmail } from '../queries';
import { AuthCard, AuthCardFooter } from './AuthCard';

/** Shown once a sign-up is accepted: the account exists, but not until the emailed link is opened. */
export function VerifyEmailNotice({
  email,
  onChangeEmail,
}: {
  email: string;
  onChangeEmail: () => void;
}) {
  const { t } = useTranslation('auth');
  const { forError } = useErrorMessages();
  const resend = useResendVerificationEmail();

  return (
    <AuthCard
      icon={
        <div className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Mail aria-hidden className="size-6" strokeWidth={1.5} />
        </div>
      }
      title={t('verifyEmail.title')}
      description={
        <Trans
          t={t}
          i18nKey="verifyEmail.description"
          values={{ email }}
          components={{ email: <span className="font-medium text-ink" /> }}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <Button type="button" disabled={resend.isPending} onClick={() => resend.mutate(email)}>
          {t('verifyEmail.resend')}
        </Button>
        <p role="status" className="text-center text-small text-success">
          {resend.isSuccess ? t('verifyEmail.resent') : null}
        </p>
        {resend.isError ? <ErrorBanner>{forError(resend.error)}</ErrorBanner> : null}
      </div>

      <AuthCardFooter>
        {t('verifyEmail.wrongEmail')}{' '}
        <Button type="button" variant="link" onClick={onChangeEmail}>
          {t('verifyEmail.changeEmail')}
        </Button>
      </AuthCardFooter>
    </AuthCard>
  );
}
