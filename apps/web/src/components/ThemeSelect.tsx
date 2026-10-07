import type { ParseKeys } from 'i18next';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Select } from '@/components/ui/select';
import { THEME_PREFERENCES, useThemePreference, type ThemePreference } from '@/lib/theme';

const themeLabelKeys = {
  system: 'theme.system',
  light: 'theme.light',
  dark: 'theme.dark',
} as const satisfies Record<ThemePreference, ParseKeys<'common'>>;

const themeIcons = {
  system: Monitor,
  light: Sun,
  dark: Moon,
} as const satisfies Record<ThemePreference, LucideIcon>;

function isThemePreference(value: string): value is ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function ThemeSelect() {
  const { t } = useTranslation();
  const { preference, setPreference } = useThemePreference();
  const Icon = themeIcons[preference];

  // The leading icon shows the current choice, so the control reads as a theme picker.
  return (
    <Select
      aria-label={t('theme.label')}
      size="sm"
      value={preference}
      onValueChange={(next) => {
        if (isThemePreference(next)) setPreference(next);
      }}
      options={THEME_PREFERENCES.map((option) => ({
        value: option,
        label: t(themeLabelKeys[option]),
      }))}
      icon={<Icon aria-hidden strokeWidth={1.5} className="size-4 shrink-0 text-ink-muted" />}
      className="w-auto"
      contentClassName="min-w-36"
    />
  );
}
