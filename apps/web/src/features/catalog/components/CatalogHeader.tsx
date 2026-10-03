import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/** The catalog's title over its section tabs, shared by Products and Categories. */
export function CatalogHeader({
  section,
  action,
}: {
  section: 'products' | 'categories';
  action?: ReactNode;
}) {
  const { t } = useTranslation('catalog');
  const tab =
    '-mb-px flex h-11 shrink-0 items-center border-b-2 px-1 text-body font-medium transition-colors duration-[120ms]';
  const tabState = (current: boolean) =>
    current ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink';

  return (
    <>
      <header className="flex flex-wrap items-center gap-4">
        <div className="flex grow flex-col gap-1">
          <h1 className="text-display">{t('list.title')}</h1>
          <p className="text-body text-ink-muted">{t('list.description')}</p>
        </div>
        {action}
      </header>
      <nav
        aria-label={t('list.tabs.label')}
        className="-mt-2 flex gap-6 overflow-x-auto border-b border-border"
      >
        <Link
          to="/catalog"
          aria-current={section === 'products' ? 'page' : undefined}
          className={cn(tab, tabState(section === 'products'))}
        >
          {t('list.tabs.products')}
        </Link>
        <Link
          to="/catalog/categories"
          aria-current={section === 'categories' ? 'page' : undefined}
          className={cn(tab, tabState(section === 'categories'))}
        >
          {t('list.tabs.categories')}
        </Link>
      </nav>
    </>
  );
}
