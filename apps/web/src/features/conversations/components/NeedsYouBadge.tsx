import { useTranslation } from 'react-i18next';

import { useConversationCounts } from '../queries';

/** The sidebar's count of chats the assistant handed to the seller. */
export function NeedsYouBadge() {
  const { t } = useTranslation('conversations');
  const counts = useConversationCounts();
  const count = counts.data?.needsYou ?? 0;
  if (count === 0) {
    return null;
  }

  return (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-label text-on-accent tabular-nums">
      {count}
      <span className="sr-only">{t('filters.needs_you')}</span>
    </span>
  );
}
