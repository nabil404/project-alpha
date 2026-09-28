import { useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ErrorCode } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';

import { linkedAccountsQueryOptions, useLinkSocial, type SocialProvider } from '../queries';
import { FacebookLogo, GoogleLogo } from './ProviderLogos';
import { UnlinkAccountDialog } from './UnlinkAccountDialog';

const PROVIDERS: readonly { id: SocialProvider; Logo: () => React.JSX.Element }[] = [
  { id: 'facebook', Logo: FacebookLogo },
  { id: 'google', Logo: GoogleLogo },
];

/**
 * Settings > Account: the ways this seller can sign in, and the one place a
 * Facebook sign-in joins an existing account. Facebook doesn't guarantee a
 * verified email, so signing in with it never links on its own. Google and
 * Facebook can be unlinked here too, but never the seller's last method.
 */
export function SignInMethodsCard({
  error,
}: {
  /** Why the provider round trip failed, from Better Auth's callback redirect. */
  error?: ErrorCode;
}) {
  const { t } = useTranslation('settings');
  const { forError, forCode } = useErrorMessages();
  const accounts = useQuery(linkedAccountsQueryOptions());
  const link = useLinkSocial();

  if (accounts.isPending) {
    return (
      <div aria-busy className="h-64 rounded-lg border border-border bg-surface shadow-card" />
    );
  }
  if (accounts.isError) {
    return <ErrorBanner>{forError(accounts.error)}</ErrorBanner>;
  }

  const linked = new Map(accounts.data.map((account) => [account.providerId, account.id]));
  // Better Auth refuses to remove the last one, so it isn't offered.
  const canUnlink = accounts.data.length > 1;

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6 shadow-card">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-heading">{t('account.signInMethods.title')}</h2>
        <p className="text-body text-ink-muted">{t('account.signInMethods.description')}</p>
      </div>

      {error && <ErrorBanner>{forCode(error)}</ErrorBanner>}
      {link.isError && <ErrorBanner>{forError(link.error)}</ErrorBanner>}

      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {linked.has('credential') && (
          <MethodRow
            icon={<KeyRound aria-hidden className="size-5 text-ink-muted" strokeWidth={1.5} />}
            label={t('account.signInMethods.providers.credential')}
          >
            <LinkedBadge />
          </MethodRow>
        )}
        {PROVIDERS.map(({ id, Logo }) => {
          const accountId = linked.get(id);

          return (
            <MethodRow key={id} icon={<Logo />} label={t(`account.signInMethods.providers.${id}`)}>
              {accountId ? (
                <>
                  <LinkedBadge />
                  {canUnlink && <UnlinkAccountDialog accountId={accountId} provider={id} />}
                </>
              ) : (
                <Button
                  // Stays disabled once it succeeds: the browser is already leaving for the provider.
                  disabled={link.isPending || link.isSuccess}
                  onClick={() => link.mutate(id)}
                >
                  {t('account.signInMethods.link')}
                </Button>
              )}
            </MethodRow>
          );
        })}
      </ul>
    </section>
  );
}

function MethodRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-4 p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken">
        {icon}
      </span>
      <span className="min-w-0 grow truncate text-body font-medium">{label}</span>
      {children}
    </li>
  );
}

function LinkedBadge() {
  const { t } = useTranslation('settings');

  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-label text-success">
      <span aria-hidden className="size-1.5 rounded-full bg-success" />
      {t('account.signInMethods.linked')}
    </span>
  );
}
