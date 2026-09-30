import { useState, type ComponentProps } from 'react';

import { Input } from '@/components/ui/input';

const split = (text: string) =>
  text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

type CommaListInputProps = Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string[];
  onChange: (items: string[]) => void;
};

/** A list typed as "summer, cotton, bestseller". The text stays as typed until it changes from outside. */
export function CommaListInput({ value, onChange, onBlur, ...props }: CommaListInputProps) {
  const [text, setText] = useState(() => value.join(', '));

  if (!same(split(text), value)) {
    setText(value.join(', '));
  }

  return (
    <Input
      {...props}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const items = split(event.target.value);
        if (!same(items, value)) onChange(items);
      }}
      onBlur={(event) => {
        setText(value.join(', '));
        onBlur?.(event);
      }}
    />
  );
}
