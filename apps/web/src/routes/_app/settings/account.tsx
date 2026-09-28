import { createFileRoute } from '@tanstack/react-router';
import { accountSettingsSearchSchema, type AccountSettingsSearch } from '@app/shared';

import { linkedAccountsQueryOptions, SignInMethodsCard } from '@/features/auth';

/** Also where linking Google or Facebook lands: `?error=<code>` after a refused link. */
export const Route = createFileRoute('/_app/settings/account')({
  validateSearch: (search: Record<string, unknown>): AccountSettingsSearch =>
    accountSettingsSearchSchema.parse(search),
  loader: ({ context }) => context.queryClient.prefetchQuery(linkedAccountsQueryOptions()),
  component: AccountSettingsPage,
});

function AccountSettingsPage() {
  const { error } = Route.useSearch();

  return <SignInMethodsCard error={error} />;
}
