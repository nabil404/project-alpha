import { MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** The thread pane before a chat is picked. Wide screens only: narrow ones show the list. */
export function NoConversationSelected() {
  const { t } = useTranslation('conversations');

  return (
    <div className="flex grow flex-col items-center justify-center gap-2 p-6 text-center">
      <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
        <MessageCircle aria-hidden className="size-6" strokeWidth={1.5} />
      </span>
      <h2 className="text-heading">{t('empty.title')}</h2>
      <p className="text-body text-ink-muted">{t('empty.description')}</p>
    </div>
  );
}
