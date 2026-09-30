import { createFileRoute, Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/_app/catalog/')({
  component: CatalogPage,
});

/** The products list waits on a list route in the API; until then this only starts a product. */
function CatalogPage() {
  const { t } = useTranslation('catalog');

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="grow text-display">{t('list.title')}</h1>
        <Button asChild variant="primary">
          <Link to="/catalog/products/new">
            <Plus aria-hidden strokeWidth={1.5} />
            {t('list.addProduct')}
          </Link>
        </Button>
      </header>
      <p className="text-body text-ink-muted">{t('list.empty')}</p>
    </div>
  );
}
