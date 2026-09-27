import { Link } from '@tanstack/react-router';
import { Mail } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { RESET_PASSWORD_TOKEN_TTL } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';

import { useRequestPasswordReset } from '../queries';
import { AuthCard, AuthCardFooter, AuthCardIcon } from './AuthCard';

/**
 * Shown after any forgot-password request, whether or not the email has an
 * account: the API answers both the same, and so does this.
 */
export function ResetLinkSentNotice({ email }: { email: string }) {
  const { t } = useTranslation('auth');
  const { forError } = useErrorMessages();
  const resend = useRequestPasswordReset();

  return (
    <AuthCard
      icon={<AuthCardIcon icon={Mail} />}
      title={t('checkEmail.title')}
      description={
        <>
          <Trans
            t={t}
            i18nKey="checkEmail.description"
            values={{ email }}
            components={{ email: <span className="font-medium text-ink" /> }}
          />{' '}
          {t('checkEmail.expiresIn', { count: RESET_PASSWORD_TOKEN_TTL / 60 })}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-small text-ink-muted">
          <Trans
            t={t}
            i18nKey="checkEmail.notReceived"
            components={{
              resend: (
                <Button
                  type="button"
                  variant="link"
                  disabled={resend.isPending}
                  onClick={() => resend.mutate({ email })}
                  className="text-small font-medium disabled:bg-transparent"
                />
              ),
            }}
          />
        </p>
        <p role="status" className="text-small text-success">
          {resend.isSuccess ? t('checkEmail.resent') : null}
        </p>
        {resend.isError ? <ErrorBanner>{forError(resend.error)}</ErrorBanner> : null}
      </div>

      <AuthCardFooter>
        <Link to="/sign-in" className="font-medium text-link hover:underline">
          {t('backToSignIn')}
        </Link>
      </AuthCardFooter>
    </AuthCard>
  );
}
