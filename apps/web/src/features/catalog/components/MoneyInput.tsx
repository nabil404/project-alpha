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

const toText = (amount: number | null) =>
  amount === null || Number.isNaN(amount) ? '' : String(fromMinorUnits(amount));

type MoneyInputProps = Omit<ComponentProps<'input'>, 'value' | 'onChange'> &
  (
    | {
        nullable?: false;
        /** Minor units; NaN while the text isn't an amount, so the schema reports it. */
        value: number;
        onChange: (amount: number) => void;
      }
    | {
        /** An empty field is `null`, not an error: "no amount". */
        nullable: true;
        value: number | null;
        onChange: (amount: number | null) => void;
      }
  );

/** An amount typed in major units, with the currency symbol inside the field. */
export function MoneyInput({ nullable, value, onChange, className, ...props }: MoneyInputProps) {
  const { currencySymbol } = useFormatters();
  const parse = (text: string) => (nullable && text.trim() === '' ? null : parseAmount(text));
  const [text, setText] = useState(() => toText(value));

  // A reset or a save puts a new amount in from outside: show it.
  if (!Object.is(value, parse(text))) {
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
          (onChange as (amount: number | null) => void)(parse(event.target.value));
        }}
      />
    </div>
  );
}
