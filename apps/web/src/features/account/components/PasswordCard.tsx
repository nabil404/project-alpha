import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import {
  linkedAccountsQueryOptions,
  sessionQueryOptions,
  useRequestPasswordReset,
  type LinkedAccount,
} from '@/features/auth';
import { useErrorMessages } from '@/i18n/error-keys';
import { useFormatters } from '@/lib/format';
import { useToast } from '@/lib/toast';

import { CardSkeleton } from './CardSkeleton';
import { ChangePasswordDialog } from './ChangePasswordDialog';

/**
 * Settings > Account: change the password, or - for a seller who signed up
 * with Google or Facebook - add one. Adding goes through the emailed reset
 * link, which proves the seller controls the mailbox; Better Auth creates the
 * password sign-in when none exists, then signs every session out.
 */
export function PasswordCard() {
  const { forError } = useErrorMessages();
  const accounts = useQuery(linkedAccountsQueryOptions());
  const session = useQuery(sessionQueryOptions());

  if (accounts.isPending || !session.data) {
    return <CardSkeleton />;
  }
  if (accounts.isError) {
    return <ErrorBanner>{forError(accounts.error)}</ErrorBanner>;
  }

  const credential = accounts.data.find((account) => account.providerId === 'credential');

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6 shadow-card">
      {credential ? (
        <HasPassword credential={credential} />
      ) : (
        <NoPassword accounts={accounts.data} email={session.data.user.email} />
      )}
    </section>
  );
}

function HasPassword({ credential }: { credential: LinkedAccount }) {
  const { t } = useTranslation('settings');
  const { formatDate } = useFormatters();
  const toast = useToast();

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-heading">{t('account.password.title')}</h2>
        <p className="text-body text-ink-muted">
          {t('account.password.lastChanged', { date: formatDate(credential.updatedAt) })}
        </p>
      </div>
      <div>
        <ChangePasswordDialog onChanged={() => toast.success(t('account.password.changed'))} />
      </div>
    </>
  );
}

function NoPassword({ accounts, email }: { accounts: LinkedAccount[]; email: string }) {
  const { t } = useTranslation('settings');
  const { forError } = useErrorMessages();
  const { locale } = useFormatters();
  const request = useRequestPasswordReset();

  const providers = new Intl.ListFormat(locale, { type: 'conjunction' }).format(
    accounts
      .filter((account) => account.providerId !== 'credential')
      .map((account) => t(`account.signInMethods.providers.${account.providerId}`)),
  );

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-heading">{t('account.password.title')}</h2>
        <p className="text-body text-ink-muted">
          {t('account.password.noPassword', { providers, email })}
        </p>
      </div>
      {request.isError && <ErrorBanner>{forError(request.error)}</ErrorBanner>}
      {request.isSuccess ? (
        <p role="status" className="text-body">
          {t('account.password.linkSent', { email })}
        </p>
      ) : (
        <div>
          <Button disabled={request.isPending} onClick={() => request.mutate({ email })}>
            <Mail aria-hidden strokeWidth={1.5} />
            {t('account.password.sendLink')}
          </Button>
        </div>
      )}
    </>
  );
}
