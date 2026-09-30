import type { ConversationState, ProductStatus, StockStatus } from '@app/shared';

/**
 * Status → badge tone, in one place (docs/DESIGN.md, "Status badge tones").
 * `satisfies Record<Enum, …>` fails the typecheck when a member is added
 * upstream without a tone. `null` means the status shows no badge.
 */
export type StatusTone = 'accent' | 'neutral' | 'success' | 'warning' | 'danger';

export const conversationStateTones = {
  browsing: null,
  collecting_details: null,
  awaiting_confirmation: 'warning',
  confirmed: 'success',
  handed_off: 'warning',
  abandoned: 'neutral',
} as const satisfies Record<ConversationState, StatusTone | null>;

export const productStatusTones = {
  draft: 'neutral',
  active: 'success',
  archived: 'neutral',
} as const satisfies Record<ProductStatus, StatusTone>;

export const stockStatusTones = {
  in_stock: 'success',
  out_of_stock: 'danger',
} as const satisfies Record<StockStatus, StatusTone>;

export const statusToneClasses = {
  accent: 'bg-accent-soft text-accent',
  neutral: 'bg-surface-sunken text-ink-muted',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} as const satisfies Record<StatusTone, string>;
