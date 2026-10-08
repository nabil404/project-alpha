import { useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OrderItemInput } from '@app/shared';

import { Button } from '@/components/ui/button';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/features/catalog';
import { useFormatters } from '@/lib/format';

import { VariantPicker, type PickedVariant } from './VariantPicker';

/** Every line carries its price, so what the seller sees is what is saved. */
export type EditableLine = Required<OrderItemInput>;
export interface ItemsFormValues {
  items: EditableLine[];
}

/** What a line shows beside its fields; not sent, since the API snapshots its own. */
export interface LineInfo {
  label: string;
  sku: string | null;
}

/**
 * An order's lines as a form: price and quantity per line, a way to remove
 * one and to add another, and the subtotal. Shared by the item edit and the
 * new order dialogs, each passing its own form, which must keep the lines at
 * `items`.
 */
export function ItemsEditor({
  form,
  info,
  onAddInfo,
  currency,
}: {
  form: UseFormReturn<ItemsFormValues>;
  info: ReadonlyMap<string, LineInfo>;
  onAddInfo: (variantId: string, line: LineInfo) => void;
  currency: string;
}) {
  const { t } = useTranslation('orders');
  const { formatMoney } = useFormatters();
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  const lines = useWatch({ control: form.control, name: 'items' });
  const subtotal = lines.reduce(
    (sum, line) =>
      Number.isInteger(line.unitPrice) && Number.isInteger(line.quantity)
        ? sum + line.unitPrice * line.quantity
        : sum,
    0,
  );
  const taken = new Set(lines.map((line) => line.variantId));
  const listError = form.formState.errors.items?.root ?? form.formState.errors.items;

  const onPick = (variant: PickedVariant) => {
    onAddInfo(variant.variantId, { label: variant.label, sku: variant.sku });
    append({ variantId: variant.variantId, quantity: 1, unitPrice: variant.price });
  };

  return (
    <div className="flex flex-col gap-3">
      {fields.length === 0 ? (
        <p className="rounded-md bg-surface-sunken px-4 py-3 text-small text-ink-muted">
          {t('items.none')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {fields.map((field, index) => {
            const line = info.get(field.variantId);
            const value = lines[index];
            return (
              <li
                key={field.id}
                className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-start"
              >
                <div className="flex min-w-0 grow flex-col">
                  <span className="text-body font-medium break-words">
                    {line?.label ?? t('items.unknownVariant')}
                  </span>
                  {line?.sku && (
                    <span className="font-mono text-code text-ink-muted">{line.sku}</span>
                  )}
                  {value && Number.isInteger(value.unitPrice * value.quantity) && (
                    <span className="text-small text-ink-muted tabular-nums">
                      {t('items.lineTotal', {
                        total: formatMoney(value.unitPrice * value.quantity, currency),
                      })}
                    </span>
                  )}
                </div>
                <div className="flex items-start gap-2">
                  <FormField
                    control={form.control}
                    name={`items.${index}.unitPrice`}
                    render={({ field: priceField }) => (
                      <FormItem className="w-32">
                        <FormLabel className="text-small">{t('items.price')}</FormLabel>
                        <FormControl>
                          <MoneyInput
                            value={priceField.value}
                            onChange={priceField.onChange}
                            onBlur={priceField.onBlur}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`items.${index}.quantity`}
                    render={({ field: quantityField }) => (
                      <FormItem className="w-20">
                        <FormLabel className="text-small">{t('items.quantity')}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            step={1}
                            className="tabular-nums"
                            name={quantityField.name}
                            ref={quantityField.ref}
                            onBlur={quantityField.onBlur}
                            value={Number.isNaN(quantityField.value) ? '' : quantityField.value}
                            onChange={(event) => quantityField.onChange(event.target.valueAsNumber)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-6 shrink-0"
                    aria-label={t('items.remove', { item: line?.label ?? '' })}
                    onClick={() => remove(index)}
                  >
                    <Trash2 aria-hidden strokeWidth={1.5} />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {listError?.message && (
        <p role="alert" className="text-small text-danger">
          {listError.message}
        </p>
      )}

      <VariantPicker taken={taken} onPick={onPick} />

      <p className="flex justify-between border-t border-border pt-3 text-body">
        <span className="text-ink-muted">{t('items.subtotal')}</span>
        <span className="font-medium tabular-nums">{formatMoney(subtotal, currency)}</span>
      </p>
    </div>
  );
}
