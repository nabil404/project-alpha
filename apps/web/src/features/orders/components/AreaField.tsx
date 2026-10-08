import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OrderItemInput } from '@app/shared';

import { Select } from '@/components/ui/select';
// The queries file, not the settings barrel, which reaches back into the catalog and orders.
import { deliverySettingsQueryOptions } from '@/features/settings/delivery-queries';
import { useFormatters } from '@/lib/format';

import { useDeliveryQuote } from '../queries';

/** A Settings delivery charge an order can be priced by. */
export interface DeliveryRate {
  id: string;
  /** Null for everywhere else. */
  areaName: string | null;
  charge: number;
}

/** The shop's areas, then everywhere else; empty until it has set any. */
export function useDeliveryRates(): DeliveryRate[] {
  const settings = useQuery(deliverySettingsQueryOptions());
  if (!settings.data) return [];
  const { deliveryCharges, everywhereElse } = settings.data;
  return [
    ...deliveryCharges.map((row) => ({ id: row.id, areaName: row.areaName, charge: row.charge })),
    ...(everywhereElse
      ? [{ id: everywhereElse.id, areaName: null, charge: everywhereElse.charge }]
      : []),
  ];
}

export interface AreaPick {
  chargeId: string | null;
  /** The name the order keeps; blank for everywhere else or none. */
  area: string;
}

const KEEP = 'keep';

/**
 * Picks the order's area from the shop's delivery charges. An order whose area
 * was typed, or whose area has since been removed, keeps showing its name
 * until another is picked.
 */
export function AreaSelect({
  rates,
  chargeId,
  area,
  onPick,
  ...props
}: Omit<ComponentProps<typeof Select>, 'value' | 'onValueChange' | 'options'> & {
  rates: DeliveryRate[];
  chargeId: string | null;
  area: string;
  onPick: (pick: AreaPick) => void;
}) {
  const { t } = useTranslation('orders');
  const { formatMoney } = useFormatters();
  const unlisted = chargeId === null ? area.trim() !== '' : !rates.some((r) => r.id === chargeId);

  return (
    <Select
      {...props}
      value={chargeId ?? (unlisted ? KEEP : '')}
      onValueChange={(next) => {
        const rate = rates.find((r) => r.id === next);
        if (rate) onPick({ chargeId: rate.id, area: rate.areaName ?? '' });
        else if (next === '') onPick({ chargeId: null, area: '' });
      }}
      options={[
        ...(unlisted ? [{ value: chargeId ?? KEEP, label: area || t('delivery.elsewhere') }] : []),
        ...rates.map((rate) => ({
          value: rate.id,
          label:
            rate.areaName === null
              ? t('delivery.elsewhereOption', { charge: formatMoney(rate.charge) })
              : t('delivery.areaOption', { area: rate.areaName, charge: formatMoney(rate.charge) }),
        })),
        { value: '', label: t('delivery.noArea') },
      ]}
    />
  );
}

/**
 * Keeps an order form's fee on the quote for its area and items. `requote`
 * (on picking an area) always takes the quote; a change to the items takes a
 * new one only while the fee is still the last quote, so a fee the seller
 * typed stays, and an existing order's fee never moves just by opening it.
 */
export function useQuotedFee({
  chargeId,
  items,
  fee,
  setFee,
}: {
  chargeId: string | null;
  items: readonly OrderItemInput[];
  fee: number;
  setFee: (fee: number) => void;
}): { freeApplied: boolean; requote: (chargeId: string | null) => void } {
  const quote = useDeliveryQuote();
  const [freeApplied, setFreeApplied] = useState(false);
  const lastQuote = useRef<number | null>(null);

  // Lines still being typed can't be priced; they wait until they can.
  const payload = JSON.stringify(
    items
      .filter(
        (item) =>
          Number.isInteger(item.quantity) &&
          item.quantity > 0 &&
          (item.unitPrice === undefined || Number.isInteger(item.unitPrice)),
      )
      .map(({ variantId, quantity, unitPrice }) => ({ variantId, quantity, unitPrice })),
  );

  const latest = useRef({ chargeId, fee, setFee, payload, mutate: quote.mutate });
  latest.current = { chargeId, fee, setFee, payload, mutate: quote.mutate };

  const requote = useCallback((next: string | null) => {
    const { payload: items, mutate } = latest.current;
    if (!next) {
      lastQuote.current = null;
      setFreeApplied(false);
      return;
    }
    mutate(
      { deliveryChargeId: next, items: JSON.parse(items) as OrderItemInput[] },
      {
        onSuccess: (answer) => {
          lastQuote.current = answer.fee;
          latest.current.setFee(answer.fee);
          setFreeApplied(answer.freeDeliveryApplied);
        },
      },
    );
  }, []);

  useEffect(() => {
    const { chargeId: current, fee: shown } = latest.current;
    if (current && lastQuote.current !== null && lastQuote.current === shown) requote(current);
  }, [payload, requote]);

  return { freeApplied, requote };
}

/** The area an order shows: its name, "Everywhere else", or null for none. */
export function useAreaLabel() {
  const { t } = useTranslation('orders');
  return (delivery: { area: string | null; everywhereElse: boolean }): string | null =>
    delivery.area ?? (delivery.everywhereElse ? t('delivery.elsewhere') : null);
}
