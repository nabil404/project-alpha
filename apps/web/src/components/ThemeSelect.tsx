import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';

import { THEME_PREFERENCES, useThemePreference, type ThemePreference } from '@/lib/theme';

const themeLabelKeys = {
  system: 'theme.system',
  light: 'theme.light',
  dark: 'theme.dark',
} as const satisfies Record<ThemePreference, ParseKeys<'common'>>;

function isThemePreference(value: string): value is ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function ThemeSelect() {
  const { t } = useTranslation();
  const { preference, setPreference } = useThemePreference();

  return (
    <select
      aria-label={t('theme.label')}
      value={preference}
      onChange={(event) => {
        if (isThemePreference(event.target.value)) {
          setPreference(event.target.value);
        }
      }}
      className="h-8 cursor-pointer rounded-md border border-border-strong bg-surface px-3 text-label text-ink hover:bg-surface-hover"
    >
      {THEME_PREFERENCES.map((option) => (
        <option key={option} value={option}>
          {t(themeLabelKeys[option])}
        </option>
      ))}
    </select>
  );
}
