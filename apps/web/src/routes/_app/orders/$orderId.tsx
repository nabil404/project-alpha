import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import {
  OrderDetailView,
  orderActivityQueryOptions,
  orderQueryOptions,
  useOrder,
} from '@/features/orders';
import { useErrorMessages } from '@/i18n/error-keys';

export const Route = createFileRoute('/_app/orders/$orderId')({
  loader: ({ context, params: { orderId } }) =>
    Promise.all([
      context.queryClient.prefetchQuery(orderQueryOptions(orderId)),
      context.queryClient.prefetchQuery(orderActivityQueryOptions(orderId)),
    ]),
  component: OrderPage,
});

function OrderPage() {
  const { orderId } = Route.useParams();
  const { t } = useTranslation('orders');
  const { forError } = useErrorMessages();
  const order = useOrder(orderId);

  if (order.data) {
    // Keyed, so moving to another order drops a half-written note or tracking number.
    return <OrderDetailView key={orderId} order={order.data} />;
  }

  if (order.isError) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-4">
        <ErrorBanner className="self-stretch">{forError(order.error)}</ErrorBanner>
        <Button asChild>
          <Link to="/orders">{t('detail.backToOrders')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div aria-busy className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="h-14 w-72 animate-pulse rounded-md bg-surface-sunken" />
      <div className="h-24 animate-pulse rounded-lg bg-surface-sunken" />
      <div className="h-96 animate-pulse rounded-lg bg-surface-sunken" />
    </div>
  );
}
