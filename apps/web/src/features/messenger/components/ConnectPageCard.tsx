import { Lock, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { useErrorMessages } from '@/i18n/error-keys';

import { useStartPageConnect } from '../queries';

const STEPS = ['signIn', 'choose', 'allow'] as const;

/** The invitation to connect a Page, shown while the shop has none. */
export function ConnectPageCard() {
  const { t } = useTranslation('settings');
  const { forError } = useErrorMessages();
  const start = useStartPageConnect();

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6 shadow-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <MessageCircle aria-hidden className="size-7" strokeWidth={1.5} />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-title">{t('messenger.connect.title')}</h2>
          <p className="text-body text-ink-muted">{t('messenger.connect.description')}</p>
        </div>
      </div>

      <ol className="flex flex-col gap-4">
        {STEPS.map((step, index) => (
          <li key={step} className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-label text-accent"
            >
              {index + 1}
            </span>
            <span className="flex flex-col">
              <span className="text-body font-medium">
                {t(`messenger.connect.steps.${step}.title`)}
              </span>
              <span className="text-small text-ink-muted">
                {t(`messenger.connect.steps.${step}.description`)}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {start.isError && <ErrorBanner>{forError(start.error)}</ErrorBanner>}

      <Button
        variant="primary"
        className="h-11 self-stretch sm:self-start"
        // Stays disabled once it succeeds: the browser is already leaving for Facebook.
        disabled={start.isPending || start.isSuccess}
        onClick={() => start.mutate()}
      >
        {t('messenger.connect.action')}
      </Button>

      <p className="flex items-start gap-2 rounded-md bg-surface-sunken px-4 py-3 text-small text-ink-muted">
        <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.5} />
        {t('messenger.connect.privacy')}
      </p>
    </section>
  );
}
