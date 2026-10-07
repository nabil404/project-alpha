import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

import { orderRanges, type OrderRange, type OrderRangeChoice } from '../date-range';

/**
 * When the orders were placed: a preset, or two days of the seller's choice.
 * The days are the shop's calendar days; the list turns them into instants.
 */
export function DateRangeFilter({
  value,
  onChange,
}: {
  value: OrderRangeChoice;
  onChange: (choice: OrderRangeChoice) => void;
}) {
  const { t } = useTranslation('orders');

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <div className="w-full sm:w-48">
        <Select
          aria-label={t('list.range.label')}
          value={value.range}
          onValueChange={(next) => {
            const range = next as OrderRange;
            onChange(range === 'custom' ? { ...value, range } : { range });
          }}
          options={orderRanges.map((range) => ({
            value: range,
            label: t(`list.range.${range}`),
          }))}
        />
      </div>
      {value.range === 'custom' && (
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            type="date"
            aria-label={t('list.range.from')}
            value={value.from ?? ''}
            max={value.to}
            onChange={(event) => onChange({ ...value, from: event.target.value || undefined })}
            className="sm:w-40"
          />
          <span aria-hidden className="text-ink-muted">
            –
          </span>
          <Input
            type="date"
            aria-label={t('list.range.to')}
            value={value.to ?? ''}
            min={value.from}
            onChange={(event) => onChange({ ...value, to: event.target.value || undefined })}
            className="sm:w-40"
          />
        </div>
      )}
    </div>
  );
}
