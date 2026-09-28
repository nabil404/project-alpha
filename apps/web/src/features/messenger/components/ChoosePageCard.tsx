import { useTranslation } from 'react-i18next';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';

import { useConnectPage, usePageCandidates, useStartPageConnect } from '../queries';
import { PageAvatar } from './PageAvatar';

/**
 * Back from Facebook: the Pages the seller granted, one to connect. The Page
 * the shop already has is offered too, as a reconnect that renews its access.
 */
export function ChoosePageCard({
  currentPageId,
  onDone,
}: {
  currentPageId?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation('settings');
  const { forError } = useErrorMessages();
  const candidates = usePageCandidates(true);
  const connect = useConnectPage();
  const startAgain = useStartPageConnect();
  const failure = candidates.error ?? connect.error ?? startAgain.error;
  const pages = candidates.data?.pages;

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6 shadow-card">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-heading">{t('messenger.choose.title')}</h2>
        <p className="text-body text-ink-muted">{t('messenger.choose.description')}</p>
      </div>

      {failure && <ErrorBanner>{forError(failure)}</ErrorBanner>}

      {candidates.isPending && <div aria-busy className="h-20 rounded-md bg-surface-sunken" />}

      {pages?.length === 0 && (
        <p className="text-body text-ink-muted">{t('messenger.choose.empty')}</p>
      )}

      {pages && pages.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {pages.map((page) => {
            const label =
              page.pageId === currentPageId
                ? t('messenger.connected.reconnect')
                : t('messenger.choose.connect');
            return (
              <li key={page.pageId} className="flex items-center gap-4 p-4">
                <PageAvatar name={page.name} />
                <div className="flex min-w-0 grow flex-col">
                  <span className="truncate text-body font-medium">{page.name}</span>
                  {!page.canMessage && (
                    <span className="text-small text-ink-muted">
                      {t('messenger.choose.noMessaging')}
                    </span>
                  )}
                </div>
                <Button
                  disabled={!page.canMessage || connect.isPending}
                  aria-label={`${label} ${page.name}`}
                  onClick={() => connect.mutate({ pageId: page.pageId }, { onSuccess: onDone })}
                >
                  {label}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-3">
        <Button variant="ghost" onClick={onDone}>
          {t('messenger.choose.cancel')}
        </Button>
        {(candidates.isError || pages?.length === 0) && (
          <Button
            disabled={startAgain.isPending || startAgain.isSuccess}
            onClick={() => startAgain.mutate()}
          >
            {t('messenger.choose.startAgain')}
          </Button>
        )}
      </div>
    </section>
  );
}
