import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { ErrorBanner } from '@/components/ErrorBanner';
import { CardSkeleton } from '@/features/account';
import { NotificationsCard, notificationSettingsQueryOptions } from '@/features/settings';
import { useErrorMessages } from '@/i18n/error-keys';

export const Route = createFileRoute('/_app/settings/notifications')({
  loader: ({ context }) => context.queryClient.prefetchQuery(notificationSettingsQueryOptions()),
  component: NotificationSettingsPage,
});

/** Which emails the signed-in person gets about this shop. */
function NotificationSettingsPage() {
  const settings = useQuery(notificationSettingsQueryOptions());
  const { forError } = useErrorMessages();

  if (settings.isError) {
    return <ErrorBanner>{forError(settings.error)}</ErrorBanner>;
  }
  if (!settings.data) {
    return <CardSkeleton />;
  }
  return <NotificationsCard settings={settings.data} />;
}
