import { createFileRoute } from '@tanstack/react-router';

import { NoConversationSelected } from '@/features/conversations';

export const Route = createFileRoute('/_app/conversations/')({
  component: NoConversationSelected,
});
