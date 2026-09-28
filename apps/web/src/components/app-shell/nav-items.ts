import type { LinkProps } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';
import {
  LayoutDashboard,
  MessageCircle,
  Package,
  ShoppingBag,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: ParseKeys<'common'>;
  icon: LucideIcon;
  /** Absent until the page exists: the item shows, disabled, so the shell keeps its final shape. */
  to?: LinkProps['to'];
  /** Only for `/`, which every other path would otherwise match. */
  exact?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'overview', label: 'nav.overview', icon: LayoutDashboard },
  { id: 'orders', label: 'nav.orders', icon: ShoppingBag, to: '/', exact: true },
  { id: 'conversations', label: 'nav.conversations', icon: MessageCircle },
  { id: 'catalog', label: 'nav.catalog', icon: Package, to: '/catalog' },
  { id: 'settings', label: 'nav.settings', icon: SlidersHorizontal, to: '/settings' },
];
