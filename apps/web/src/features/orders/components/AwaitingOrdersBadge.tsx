import { useTranslation } from 'react-i18next';

import { useOrderSummary } from '../queries';

/** The nav's count of drafted orders waiting for the seller to confirm them. */
export function AwaitingOrdersBadge() {
  const { t } = useTranslation('orders');
  const summary = useOrderSummary();
  const count = summary.data?.awaitingConfirmation ?? 0;
  if (count === 0) {
    return null;
  }

  return (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-label text-on-accent tabular-nums">
      {count}
      <span className="sr-only">{t('nav.awaiting')}</span>
    </span>
  );
}
