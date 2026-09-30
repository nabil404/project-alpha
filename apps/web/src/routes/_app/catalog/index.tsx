import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/_app/catalog')({
  component: CatalogPage,
});

function CatalogPage() {
  const { t } = useTranslation('catalog');

  return <h1 className="text-display">{t('list.title')}</h1>;
}
