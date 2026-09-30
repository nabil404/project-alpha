import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { DeviceSession } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';
import { ApiError } from '@/lib/api-error';
import { useFormatters } from '@/lib/format';

import { deviceSessionsQueryOptions, useRevokeDeviceSession } from '../queries';
import { CardSkeleton } from './CardSkeleton';

/**
 * Settings > Account: every device signed in to this account. Signing one out
 * isn't confirmed - it is undone by signing in again - and one that was
 * already signed out elsewhere just drops off the list.
 */
export function DevicesCard() {
  const { t } = useTranslation('settings');
  const { forError } = useErrorMessages();
  const sessions = useQuery(deviceSessionsQueryOptions());
  const revoke = useRevokeDeviceSession();

  if (sessions.isPending) {
    return <CardSkeleton />;
  }
  if (sessions.isError) {
    return <ErrorBanner>{forError(sessions.error)}</ErrorBanner>;
  }

  const alreadyGone = revoke.error instanceof ApiError && revoke.error.code === 'SESSION_NOT_FOUND';

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6 shadow-card">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-heading">{t('account.devices.title')}</h2>
        <p className="text-body text-ink-muted">{t('account.devices.description')}</p>
      </div>

      {revoke.isError && !alreadyGone && <ErrorBanner>{forError(revoke.error)}</ErrorBanner>}

      <ul className="flex flex-col divide-y divide-border">
        {sessions.data.map((session) => (
          <DeviceRow
            key={session.id}
            session={session}
            pending={revoke.isPending && revoke.variables === session.id}
            // One mutation serves every row, so a second click would move its
            // variables off the row still being signed out.
            disabled={revoke.isPending}
            onSignOut={() => revoke.mutate(session.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function DeviceRow({
  session,
  pending,
  disabled,
  onSignOut,
}: {
  session: DeviceSession;
  pending: boolean;
  disabled: boolean;
  onSignOut: () => void;
}) {
  const { t } = useTranslation('settings');
  const { formatDate, formatRelativeDay } = useFormatters();
  const { browser, os } = session;
  const name =
    browser && os ? t('account.devices.device', { browser, os }) : t('account.devices.unknown');

  return (
    <li className="flex items-center gap-4 py-3">
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-body font-medium">{name}</span>
        <span className="text-small text-ink-muted">
          {session.current
            ? t('account.devices.activeNow')
            : t('account.devices.activity', {
                signedIn: formatDate(session.createdAt),
                active: formatRelativeDay(session.lastActiveAt),
              })}
        </span>
      </div>
      {session.current ? (
        <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-success-soft px-2.5 text-label text-success">
          {t('account.devices.thisDevice')}
        </span>
      ) : (
        <Button
          size="sm"
          disabled={disabled}
          aria-busy={pending}
          aria-label={t('account.devices.signOutLabel', { device: name })}
          onClick={onSignOut}
        >
          {t('account.devices.signOut')}
        </Button>
      )}
    </li>
  );
}
