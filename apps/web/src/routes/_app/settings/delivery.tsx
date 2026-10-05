import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { ErrorBanner } from '@/components/ErrorBanner';
import { CardSkeleton } from '@/features/account';
import {
  DeliveryChargesCard,
  deliverySettingsQueryOptions,
  generalSettingsQueryOptions,
} from '@/features/settings';
import { useErrorMessages } from '@/i18n/error-keys';

export const Route = createFileRoute('/_app/settings/delivery')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.prefetchQuery(deliverySettingsQueryOptions()),
      context.queryClient.prefetchQuery(generalSettingsQueryOptions()),
    ]),
  component: DeliverySettingsPage,
});

/** Delivery charges by area, everywhere else and the free-delivery threshold, saved together. */
function DeliverySettingsPage() {
  const settings = useQuery(deliverySettingsQueryOptions());
  const { forError } = useErrorMessages();

  if (settings.isError) {
    return <ErrorBanner>{forError(settings.error)}</ErrorBanner>;
  }
  if (!settings.data) {
    return <CardSkeleton />;
  }
  return <DeliveryChargesCard settings={settings.data} />;
}
