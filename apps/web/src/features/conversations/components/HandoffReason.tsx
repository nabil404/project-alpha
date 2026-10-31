import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/lib/format';

import { useConversation } from '../queries';
import { useCustomerName } from './customer-name';

/** Why the assistant handed this chat to the seller, while it is handed off; nothing otherwise. */
export function HandoffReason({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('conversations');
  const { formatDate, isSameDay } = useFormatters();
  const customerName = useCustomerName();
  const conversation = useConversation(conversationId);
  if (!conversation.data?.handoff) return null;

  const { handoff, customer } = conversation.data;
  // Typed keys: a reason with no copy in conversations.json fails the typecheck.
  const key = `handoff.reason.${handoff.reason}` as const;
  const name = customerName(customer.name);
  const time = formatDate(handoff.at, isSameDay(handoff.at) ? 'time' : 'dateTime');

  return (
    <section aria-labelledby="handoff-reason-title" className="flex flex-col gap-3">
      <div className="flex flex-col">
        <h2 id="handoff-reason-title" className="text-heading">
          {t('handoff.title')}
        </h2>
        <span className="text-small text-ink-muted">{t('handoff.at', { time })}</span>
      </div>
      <div className="flex flex-col gap-1 rounded-lg bg-warning-soft p-4">
        <span className="text-body font-semibold">{t(`${key}.title`)}</span>
        <span className="text-small">{t(`${key}.body`, { name })}</span>
      </div>
    </section>
  );
}
