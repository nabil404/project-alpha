import { useState } from 'react';
import { Outlet, useMatches, useMatchRoute } from '@tanstack/react-router';
import { Menu, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { NAV_ITEMS } from './nav-items';
import { SidebarContent } from './SidebarContent';

/**
 * The signed-in dashboard: a fixed sidebar from `lg` up; below it, a top bar
 * whose menu button opens the same sidebar as a drawer.
 */
export function AppShell() {
  const fullBleed = useMatches({
    select: (matches) => matches.some((match) => match.staticData.fullBleed),
  });

  return (
    <div className="min-h-dvh bg-bg text-ink lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-62 shrink-0 overflow-y-auto border-r border-border bg-surface px-4 py-6 lg:block">
        <SidebarContent />
      </aside>
      <MobileTopBar />
      <main className={cn('min-w-0 grow', !fullBleed && 'px-4 py-6 sm:px-8 sm:py-8')}>
        <Outlet />
      </main>
    </div>
  );
}

function MobileTopBar() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const matchRoute = useMatchRoute();
  const current = NAV_ITEMS.find(
    ({ to, exact }) => to && matchRoute({ to, fuzzy: !exact }) !== false,
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <header className="sticky top-0 z-10 flex h-14 items-center gap-1 border-b border-border bg-surface px-2 lg:hidden">
        <Dialog.Trigger asChild>
          <Button variant="ghost" size="icon" className="size-11" aria-label={t('nav.openMenu')}>
            <Menu aria-hidden className="size-6" strokeWidth={1.5} />
          </Button>
        </Dialog.Trigger>
        <span className="min-w-0 grow truncate text-heading">
          {current ? t(current.label) : t('app.name')}
        </span>
      </header>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay lg:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 w-75 max-w-[calc(100%-3rem)] overflow-y-auto rounded-r-xl bg-surface p-4 text-ink shadow-popover lg:hidden"
        >
          <Dialog.Title className="sr-only">{t('nav.menu')}</Dialog.Title>
          <SidebarContent
            onNavigate={() => setOpen(false)}
            brandAction={
              <Dialog.Close asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={t('nav.closeMenu')}
                >
                  <X aria-hidden className="size-6" strokeWidth={1.5} />
                </Button>
              </Dialog.Close>
            }
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
