import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ThemeSelect } from '@/components/ThemeSelect';
import { AccountCard, SignOutButton } from '@/features/auth';

import { NAV_ITEMS } from './nav-items';

const itemClass =
  'flex h-10 items-center gap-3 rounded-md px-3 text-body font-medium transition-colors duration-[120ms] [&_svg]:size-5 [&_svg]:shrink-0';

/**
 * Brand, main navigation and the signed-in account: the whole sidebar on
 * desktop, and the whole drawer on mobile.
 */
export function SidebarContent({
  brandAction,
  onNavigate,
}: {
  /** Sits at the end of the brand row - the drawer's close button. */
  brandAction?: ReactNode;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col gap-8">
      <div className="flex items-center gap-3 pl-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
          <MessageSquareText aria-hidden className="size-5" strokeWidth={1.5} />
        </span>
        <span className="min-w-0 grow truncate font-semibold">{t('app.name')}</span>
        {brandAction}
      </div>

      <nav aria-label={t('nav.label')} className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ id, label, icon: Icon, to, exact, badge: Badge }) =>
          to ? (
            <Link
              key={id}
              to={to}
              activeOptions={{ exact }}
              onClick={onNavigate}
              className={itemClass}
              activeProps={{ className: 'bg-accent-soft text-accent' }}
              inactiveProps={{
                className: 'text-ink hover:bg-surface-hover [&_svg]:text-ink-muted',
              }}
            >
              <Icon aria-hidden strokeWidth={1.5} />
              {t(label)}
              {Badge && <Badge />}
            </Link>
          ) : (
            <span key={id} aria-disabled className={`${itemClass} text-ink-disabled`}>
              <Icon aria-hidden strokeWidth={1.5} />
              {t(label)}
            </span>
          ),
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <AccountCard />
        <div className="flex items-center justify-between gap-2">
          <ThemeSelect />
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
