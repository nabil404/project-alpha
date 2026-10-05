import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/lib/format';

/**
 * ORD-2026-00481: the shop's order number, zero-padded, after the year it was
 * placed. An identifier, not a quantity, so it is never locale-grouped.
 */
export function orderReference({ number, placedAt }: { number: number; placedAt: string }) {
  return `ORD-${new Date(placedAt).getFullYear()}-${String(number).padStart(5, '0')}`;
}

interface LineLabelParts {
  productName: string;
  variantName: string | null;
  quantity: number;
}

/** "Blue kurti, M × 2", or "Hijab set × 3" for a product without variants. */
export function useLineLabel() {
  const { t } = useTranslation('orders');
  return ({ productName, variantName, quantity }: LineLabelParts): string =>
    variantName
      ? t('line.withVariant', { product: productName, variant: variantName, quantity })
      : t('line.plain', { product: productName, quantity });
}

/** "Blue kurti, M × 2, Dupatta × 1". */
export function useLinesLabel() {
  const lineLabel = useLineLabel();
  const { formatList } = useFormatters();
  return (lines: LineLabelParts[]): string => formatList(lines.map(lineLabel));
}

/** "Blue kurti, M": a variant as the seller picks it, without a quantity. */
export function variantDisplayName(productName: string, variantName: string | null): string {
  return variantName ? `${productName}, ${variantName}` : productName;
}

/**
 * When an order was placed, as the list reads it: "Today, 10:05",
 * "Yesterday, 9:41", then the date alone: "3 Oct".
 */
export function usePlacedLabel() {
  const { t } = useTranslation('orders');
  const { dayOffset, formatDate } = useFormatters();

  return (placedAt: string, now: Date = new Date()): string => {
    const offset = dayOffset(placedAt, now);
    const time = formatDate(placedAt, 'time');
    if (offset === 0) return t('placed.today', { time });
    if (offset === -1) return t('placed.yesterday', { time });
    return formatDate(placedAt, 'dayMonth');
  };
}
