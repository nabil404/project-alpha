import { useState, type ComponentProps } from 'react';
import { fromMinorUnits, toMinorUnits } from '@app/shared';

import { Input } from '@/components/ui/input';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Digits, optional thousands commas, up to two decimals: "1,600" or "1600.50". */
const AMOUNT = /^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/;

function parseAmount(text: string): number {
  const trimmed = text.trim();
  return AMOUNT.test(trimmed) ? toMinorUnits(Number(trimmed.replaceAll(',', ''))) : Number.NaN;
}

const toText = (amount: number) => (Number.isNaN(amount) ? '' : String(fromMinorUnits(amount)));

type MoneyInputProps = Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  /** Minor units; NaN while the text isn't an amount, so the schema reports it. */
  value: number;
  onChange: (amount: number) => void;
};

/** An amount typed in major units, with the currency symbol inside the field. */
export function MoneyInput({ value, onChange, className, ...props }: MoneyInputProps) {
  const { currencySymbol } = useFormatters();
  const [text, setText] = useState(() => toText(value));

  // A reset or a save puts a new amount in from outside: show it.
  if (!Object.is(value, parseAmount(text))) {
    setText(toText(value));
  }

  return (
    <div className={cn('relative flex items-center', className)}>
      <span aria-hidden className="pointer-events-none absolute left-3 text-body text-ink-muted">
        {currencySymbol()}
      </span>
      <Input
        {...props}
        inputMode="decimal"
        autoComplete="off"
        className="pl-8 tabular-nums"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(parseAmount(event.target.value));
        }}
      />
    </div>
  );
}
