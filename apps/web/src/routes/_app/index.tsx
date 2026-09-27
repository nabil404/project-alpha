import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/_app/')({
  component: OrdersPage,
});

function OrdersPage() {
  const { t } = useTranslation('orders');

  return <h1 className="text-display">{t('list.title')}</h1>;
}
