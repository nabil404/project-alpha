import {
  createFileRoute,
  Link,
  Outlet,
  useMatchRoute,
  type LinkProps,
} from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';
import {
  Bell,
  Bot,
  ChevronRight,
  CircleUser,
  MessageCircle,
  Store,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/_app/settings')({
  component: SettingsLayout,
});

interface SettingsSection {
  id: string;
  label: ParseKeys<'settings'>;
  icon: LucideIcon;
  /** Absent until the section exists: it shows, disabled, so the menu keeps its final shape. */
  to?: LinkProps['to'];
}

const SECTIONS: readonly SettingsSection[] = [
  { id: 'general', label: 'nav.general', icon: Store, to: '/settings/general' },
  { id: 'messenger', label: 'nav.messenger', icon: MessageCircle, to: '/settings/messenger' },
  { id: 'assistant', label: 'nav.assistant', icon: Bot, to: '/settings/assistant' },
  { id: 'delivery', label: 'nav.delivery', icon: Truck, to: '/settings/delivery' },
  {
    id: 'notifications',
    label: 'nav.notifications',
    icon: Bell,
    to: '/settings/notifications',
  },
  { id: 'account', label: 'nav.account', icon: CircleUser, to: '/settings/account' },
];

const itemClass =
  'flex h-10 shrink-0 items-center gap-3 rounded-md px-3 text-body font-medium whitespace-nowrap transition-colors duration-[120ms] [&_svg]:size-5 [&_svg]:shrink-0';

/**
 * Settings: the section menu beside the section from `lg` up; below it, the
 * menu becomes a row that scrolls sideways above the section.
 */
function SettingsLayout() {
  const { t } = useTranslation('settings');
  const matchRoute = useMatchRoute();
  const current = SECTIONS.find(({ to }) => to && matchRoute({ to, fuzzy: true }));
  const navRef = useRef<HTMLElement>(null);

  // Below `lg` the menu scrolls sideways; bring the current section into view.
  // Set scrollLeft rather than scrollIntoView, which would also scroll the page.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const box = nav.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    nav.scrollLeft += item.left - box.left - (box.width - item.width) / 2;
  }, [current?.id]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        {current && (
          <nav aria-label={t('breadcrumb.label')} className="mb-1">
            <ol className="flex min-w-0 items-center gap-1 text-small text-ink-muted">
              <li className="shrink-0">
                <Link to="/settings" className="hover:text-ink">
                  {t('header.title')}
                </Link>
              </li>
              <li aria-hidden className="flex text-border-strong">
                <ChevronRight className="size-3.5" strokeWidth={1.5} />
              </li>
              <li aria-current="page" className="truncate font-medium text-ink">
                {t(current.label)}
              </li>
            </ol>
          </nav>
        )}
        <h1 className="text-display">{t('header.title')}</h1>
        <p className="text-body text-ink-muted">{t('header.description')}</p>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <nav
          ref={navRef}
          aria-label={t('nav.label')}
          className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:-mx-8 sm:px-8 lg:mx-0 lg:w-60 lg:shrink-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          {SECTIONS.map(({ id, label, icon: Icon, to }) =>
            to ? (
              <Link
                key={id}
                to={to}
                className={itemClass}
                activeProps={{ className: 'bg-accent-soft text-accent', 'aria-current': 'page' }}
                inactiveProps={{
                  className: 'text-ink hover:bg-surface-hover [&_svg]:text-ink-muted',
                }}
              >
                <Icon aria-hidden strokeWidth={1.5} />
                {t(label)}
              </Link>
            ) : (
              <span key={id} aria-disabled className={`${itemClass} text-ink-disabled`}>
                <Icon aria-hidden strokeWidth={1.5} />
                {t(label)}
              </span>
            ),
          )}
        </nav>

        <div className="min-w-0 grow lg:max-w-3xl">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
