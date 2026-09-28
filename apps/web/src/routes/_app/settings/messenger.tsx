import { createFileRoute } from '@tanstack/react-router';
import { messengerSettingsSearchSchema, type MessengerSettingsSearch } from '@app/shared';

import { facebookPageQueryOptions, MessengerSettings } from '@/features/messenger';

/**
 * Also where the API's Facebook callback lands: `?step=choose-page` after a
 * good round trip, `?error=<code>` after a failed one.
 */
export const Route = createFileRoute('/_app/settings/messenger')({
  validateSearch: (search: Record<string, unknown>): MessengerSettingsSearch =>
    messengerSettingsSearchSchema.parse(search),
  loader: ({ context }) => context.queryClient.prefetchQuery(facebookPageQueryOptions()),
  component: MessengerSettingsPage,
});

function MessengerSettingsPage() {
  const { step, error } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <MessengerSettings
      step={step}
      error={error}
      onFlowDone={() => void navigate({ search: {}, replace: true })}
    />
  );
}
