import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FacebookPage } from '@app/shared';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';
import { useFormatters } from '@/lib/format';

import { useStartPageConnect } from '../queries';
import { DisconnectPageDialog } from './DisconnectPageDialog';
import { PageAvatar } from './PageAvatar';

/** The shop's connected Page, with a way to renew its access or let it go. */
export function ConnectedPageCard({ page }: { page: FacebookPage }) {
  const { t } = useTranslation('settings');
  const { formatDate } = useFormatters();
  const { forError } = useErrorMessages();
  const reconnect = useStartPageConnect();

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6 shadow-card">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-heading">{t('messenger.connected.title')}</h2>
        <p className="text-body text-ink-muted">{t('messenger.connected.description')}</p>
      </div>

      <div className="flex items-center gap-4 rounded-md border border-border p-4">
        <PageAvatar name={page.name} />
        <div className="flex min-w-0 grow flex-col">
          <span className="truncate text-body font-medium">{page.name}</span>
          <span className="text-small text-ink-muted">
            {t('messenger.connected.connectedOn', { date: formatDate(page.connectedAt) })}
          </span>
        </div>
        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-label text-success">
          <span aria-hidden className="size-1.5 rounded-full bg-success" />
          {t('messenger.connected.badge')}
        </span>
      </div>

      {reconnect.isError && <ErrorBanner>{forError(reconnect.error)}</ErrorBanner>}

      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <a
            href={`https://www.facebook.com/${encodeURIComponent(page.pageId)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink aria-hidden strokeWidth={1.5} />
            {t('messenger.connected.openPage')}
          </a>
        </Button>
        <Button
          disabled={reconnect.isPending || reconnect.isSuccess}
          onClick={() => reconnect.mutate()}
        >
          {t('messenger.connected.reconnect')}
        </Button>
        <DisconnectPageDialog pageName={page.name} />
      </div>
    </section>
  );
}
