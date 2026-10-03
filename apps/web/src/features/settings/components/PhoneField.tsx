import { useRef, useState, type ComponentProps } from 'react';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { useTranslation } from 'react-i18next';
import { callingCodeOf, phoneCountryOf } from '@app/shared';

import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';

import { useCallingCodeOptions } from '../region-options';

type PhoneFieldProps = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'defaultValue'> & {
  /** E.164, blank, or whatever was typed when it does not parse. */
  value: string;
  onChange: (value: string) => void;
  /** The calling code to start with when there is no number yet. */
  defaultCountry: string;
};

function split(value: string, fallback: string): { country: string; national: string } {
  const parsed = value ? parsePhoneNumberFromString(value) : undefined;
  return {
    country: (value && phoneCountryOf(value)) || fallback,
    national: parsed ? parsed.formatNational() : '',
  };
}

/**
 * A calling code picker and the number, emitting one E.164 string
 * ("+8801812000000"). A number that does not parse is passed on as typed,
 * prefixed with its code, so the shared schema reports it.
 *
 * The input takes the id and aria attributes a FormControl gives, so the
 * field's label and error point at the number.
 */
export function PhoneField({ value, onChange, defaultCountry, ...inputProps }: PhoneFieldProps) {
  const { t } = useTranslation('settings');
  const options = useCallingCodeOptions();
  const [state, setState] = useState(() => split(value, defaultCountry));
  const emitted = useRef(value);

  // A reset from outside (Cancel, a save) starts the parts over from the value.
  if (value !== emitted.current) {
    emitted.current = value;
    setState(split(value, defaultCountry));
  }

  const emit = (country: string, national: string) => {
    setState({ country, national });
    const digits = national.trim();
    const next = digits
      ? (parsePhoneNumberFromString(digits, country as CountryCode)?.number ??
        `+${callingCodeOf(country) ?? ''}${digits}`)
      : '';
    emitted.current = next;
    onChange(next);
  };

  return (
    <div className="flex gap-2">
      <Combobox
        aria-label={t('general.profile.callingCode')}
        value={state.country}
        onValueChange={(country) => emit(country, state.national)}
        options={options}
        searchPlaceholder={t('general.profile.searchCountry')}
        emptyText={t('general.noMatch')}
        className="w-32 shrink-0"
        contentClassName="w-72"
        disabled={inputProps.disabled}
      />
      <Input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        {...inputProps}
        value={state.national}
        onChange={(event) => emit(state.country, event.target.value)}
      />
    </div>
  );
}
