import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useController } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { DeliverySettings, ProductDeliveryCharge } from '@app/shared';

// The queries file, not the settings barrel, which reaches back into the catalog.
import { deliverySettingsQueryOptions } from '@/features/settings/delivery-queries';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { ProductFormValues } from '../product-form';
import { MoneyInput } from './MoneyInput';

/** One row of the custom table: a named area, or everywhere else. */
interface ShopRate {
  id: string;
  label: string;
  charge: number;
}

function shopRates(settings: DeliverySettings, elsewhere: string): ShopRate[] {
  return [
    ...settings.deliveryCharges.map((row) => ({
      id: row.id,
      label: row.areaName,
      charge: row.charge,
    })),
    ...(settings.everywhereElse
      ? [
          {
            id: settings.everywhereElse.id,
            label: elsewhere,
            charge: settings.everywhereElse.charge,
          },
        ]
      : []),
  ];
}

/**
 * What delivering this product costs: the shop's charges, or its own per
 * area. An area left empty in the custom table costs the shop charge, and
 * delivery times always stay the shop's.
 */
export function DeliveryChargeCard({ className }: { className: string }) {
  const { t } = useTranslation('catalog');
  const { formatMoney } = useFormatters();
  const titleId = useId();
  const settings = useQuery(deliverySettingsQueryOptions());
  const custom = useController<ProductFormValues, 'customDelivery'>({ name: 'customDelivery' });
  const charges = useController<ProductFormValues, 'deliveryCharges'>({
    name: 'deliveryCharges',
  });

  const rates = settings.data ? shopRates(settings.data, t('delivery.elsewhere')) : [];
  const own = new Map(charges.field.value.map((row) => [row.deliveryChargeId, row.charge]));
  // The field's error is per array index, which follows `deliveryCharges`, not the table rows.
  const rowErrors = (charges.fieldState.error ?? []) as unknown as ({
    charge?: { message?: string };
  } | null)[];
  const errorFor = (id: string) =>
    rowErrors[charges.field.value.findIndex((row) => row.deliveryChargeId === id)]?.charge?.message;
  const setOwn = (id: string, charge: number | null) => {
    const rest = charges.field.value.filter((row) => row.deliveryChargeId !== id);
    const next: ProductDeliveryCharge[] =
      charge === null ? rest : [...rest, { deliveryChargeId: id, charge }];
    charges.field.onChange(next);
  };

  const summary = [
    ...rates
      .slice(0, 2)
      .map((rate) =>
        t('delivery.summaryItem', { area: rate.label, charge: formatMoney(rate.charge) }),
      ),
    ...(rates.length > 2 ? [t('delivery.more', { count: rates.length - 2 })] : []),
  ].join(t('delivery.separator'));

  const option = (selected: boolean) =>
    cn(
      'flex cursor-pointer flex-col gap-3 rounded-md border p-3',
      selected ? 'border-accent bg-accent-soft' : 'border-border',
    );

  return (
    <section className={className} aria-labelledby={titleId}>
      <div className="flex flex-col gap-0.5">
        <h2 id={titleId} className="text-heading">
          {t('delivery.title')}
        </h2>
        <p className="text-small text-ink-muted">{t('delivery.description')}</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t('delivery.title')}</legend>
        <label className={option(!custom.field.value)}>
          <span className="flex items-start gap-2.5">
            <input
              type="radio"
              name={custom.field.name}
              className="mt-1 size-4 cursor-pointer accent-accent"
              checked={!custom.field.value}
              onChange={() => {
                custom.field.onChange(false);
                // A half-typed amount can't block a save it isn't part of.
                charges.field.onChange(
                  charges.field.value.filter((row) => Number.isFinite(row.charge)),
                );
              }}
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-body font-medium">{t('delivery.shop')}</span>
              {summary && <span className="text-small text-ink-muted">{summary}</span>}
            </span>
          </span>
        </label>

        <div className={option(custom.field.value)}>
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="radio"
              name={custom.field.name}
              className="mt-1 size-4 cursor-pointer accent-accent"
              checked={custom.field.value}
              disabled={rates.length === 0}
              onChange={() => custom.field.onChange(true)}
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-body font-medium">{t('delivery.custom')}</span>
              <span className="text-small text-ink-muted">{t('delivery.customHint')}</span>
            </span>
          </label>

          {custom.field.value && rates.length > 0 && (
            <>
              <ul className="flex flex-col gap-2">
                {rates.map((rate) => (
                  <li key={rate.id} className="flex flex-col gap-1">
                    <div className="flex items-center gap-3">
                      <span className="flex min-w-0 grow flex-col">
                        <span className="truncate text-body font-medium">{rate.label}</span>
                        <span className="text-small text-ink-muted">
                          {t('delivery.shopCharge', { amount: formatMoney(rate.charge) })}
                        </span>
                      </span>
                      <MoneyInput
                        nullable
                        className="w-28 shrink-0"
                        aria-label={t('delivery.chargeFor', { area: rate.label })}
                        value={own.get(rate.id) ?? null}
                        onChange={(charge) => setOwn(rate.id, charge)}
                        onBlur={charges.field.onBlur}
                        aria-invalid={errorFor(rate.id) ? true : undefined}
                      />
                    </div>
                    {errorFor(rate.id) && (
                      <p role="alert" className="text-small text-danger">
                        {errorFor(rate.id)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-small text-ink-muted">{t('delivery.timesHint')}</p>
            </>
          )}
        </div>
      </fieldset>

      {settings.data && rates.length === 0 && (
        <p className="text-small text-ink-muted">{t('delivery.noAreas')}</p>
      )}
      <Link to="/settings/delivery" className="self-start text-small font-medium text-link">
        {t('delivery.editAreas')}
      </Link>
    </section>
  );
}
