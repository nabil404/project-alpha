import type { ParseKeys } from 'i18next';
import { ChevronDown, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

  // The native arrow can't be padded, so it is hidden and drawn as an icon.
  // The leading icon shows the current choice, so the control reads as a theme picker.
  return (
    <span className="relative inline-flex items-center">
      <Icon
        aria-hidden
        strokeWidth={1.5}
        className="pointer-events-none absolute left-2.5 size-4 text-ink-muted"
      />
      <select
        aria-label={t('theme.label')}
        value={preference}
        onChange={(event) => {
          if (isThemePreference(event.target.value)) {
            setPreference(event.target.value);
          }
        }}
        className="h-8 cursor-pointer appearance-none rounded-md border border-border-strong bg-surface pr-8 pl-8 text-label text-ink hover:bg-surface-hover"
      >
        {THEME_PREFERENCES.map((option) => (
          <option key={option} value={option}>
            {t(themeLabelKeys[option])}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        strokeWidth={1.5}
        className="pointer-events-none absolute right-2.5 size-4 text-ink-muted"
      />
    </span>
  );
}
