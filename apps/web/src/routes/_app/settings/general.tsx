import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { ErrorBanner } from '@/components/ErrorBanner';
import { CardSkeleton } from '@/features/account';
import { generalSettingsQueryOptions, RegionCard, ShopProfileCard } from '@/features/settings';
import { useErrorMessages } from '@/i18n/error-keys';

export const Route = createFileRoute('/_app/settings/general')({
  loader: ({ context }) => context.queryClient.prefetchQuery(generalSettingsQueryOptions()),
  component: GeneralSettingsPage,
});

/** The shop's profile and region; each card saves on its own. */
function GeneralSettingsPage() {
  const settings = useQuery(generalSettingsQueryOptions());
  const { forError } = useErrorMessages();

  if (settings.isError) {
    return <ErrorBanner>{forError(settings.error)}</ErrorBanner>;
  }
  if (!settings.data) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <ShopProfileCard settings={settings.data} />
      <RegionCard settings={settings.data} />
    </div>
  );
}
