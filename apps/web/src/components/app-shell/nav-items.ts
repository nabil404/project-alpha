import type { ComponentType } from 'react';
import type { LinkProps } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';
import {
  LayoutDashboard,
  MessageCircle,
  Package,
  ShoppingBag,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { UnreadBadge } from '@/features/conversations';

export interface NavItem {
  id: string;
  label: ParseKeys<'common'>;
  icon: LucideIcon;
  /** Absent until the page exists: the item shows, disabled, so the shell keeps its final shape. */
  to?: LinkProps['to'];
  /** Only for `/`, which every other path would otherwise match. */
  exact?: boolean;
  /** A count at the end of the item, fetched by the badge itself. */
  badge?: ComponentType;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'overview', label: 'nav.overview', icon: LayoutDashboard },
  { id: 'orders', label: 'nav.orders', icon: ShoppingBag, to: '/', exact: true },
  {
    id: 'conversations',
    label: 'nav.conversations',
    icon: MessageCircle,
    to: '/conversations',
    badge: UnreadBadge,
  },
  { id: 'catalog', label: 'nav.catalog', icon: Package, to: '/catalog' },
  { id: 'customers', label: 'nav.customers', icon: Users, to: '/customers' },
  { id: 'settings', label: 'nav.settings', icon: SlidersHorizontal, to: '/settings' },
];
