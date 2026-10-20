import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { ErrorBanner } from '@/components/ErrorBanner';
import { CardSkeleton } from '@/features/account';
import { AssistantVoiceCard, assistantSettingsQueryOptions } from '@/features/settings';
import { useErrorMessages } from '@/i18n/error-keys';

export const Route = createFileRoute('/_app/settings/assistant')({
  loader: ({ context }) => context.queryClient.prefetchQuery(assistantSettingsQueryOptions()),
  component: AssistantSettingsPage,
});

/** How the order assistant talks to customers. */
function AssistantSettingsPage() {
  const settings = useQuery(assistantSettingsQueryOptions());
  const { forError } = useErrorMessages();

  if (settings.isError) {
    return <ErrorBanner>{forError(settings.error)}</ErrorBanner>;
  }
  if (!settings.data) {
    return <CardSkeleton />;
  }
  return <AssistantVoiceCard settings={settings.data} />;
}
