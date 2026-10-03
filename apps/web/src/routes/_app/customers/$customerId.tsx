import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import {
  CustomerProfile,
  customerNotesQueryOptions,
  customerOrdersQueryOptions,
  customerQueryOptions,
  useCustomer,
} from '@/features/customers';
import { useErrorMessages } from '@/i18n/error-keys';

export const Route = createFileRoute('/_app/customers/$customerId')({
  loader: ({ context, params: { customerId } }) =>
    Promise.all([
      context.queryClient.prefetchQuery(customerQueryOptions(customerId)),
      context.queryClient.prefetchQuery(
        customerOrdersQueryOptions(customerId, { page: 1, pageSize: 10 }),
      ),
      context.queryClient.prefetchQuery(customerNotesQueryOptions(customerId)),
    ]),
  component: CustomerPage,
});

function CustomerPage() {
  const { customerId } = Route.useParams();
  const { t } = useTranslation('customers');
  const { forError } = useErrorMessages();
  const customer = useCustomer(customerId);

  if (customer.data) {
    // Keyed, so moving to another customer drops a half-written note and the orders page.
    return <CustomerProfile key={customerId} customer={customer.data} />;
  }

  if (customer.isError) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-4">
        <ErrorBanner className="self-stretch">{forError(customer.error)}</ErrorBanner>
        <Button asChild>
          <Link to="/customers">{t('detail.backToCustomers')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div aria-busy className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="h-14 w-72 animate-pulse rounded-md bg-surface-sunken" />
      <div className="h-96 animate-pulse rounded-lg bg-surface-sunken" />
    </div>
  );
}
