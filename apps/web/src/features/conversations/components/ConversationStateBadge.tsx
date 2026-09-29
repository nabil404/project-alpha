import type { ConversationState } from '@app/shared';

import { useStatusLabels } from '@/i18n/status-keys';
import { conversationStateTones, statusToneClasses } from '@/i18n/status-tones';
import { cn } from '@/lib/utils';

/** Nothing for the states that need no one's attention (browsing, collecting details). */
export function ConversationStateBadge({ state }: { state: ConversationState }) {
  const { conversationState } = useStatusLabels();
  const tone = conversationStateTones[state];
  if (!tone) {
    return null;
  }

  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-label whitespace-nowrap',
        statusToneClasses[tone],
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {conversationState(state)}
    </span>
  );
}
