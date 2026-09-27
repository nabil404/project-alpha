import { useCallback, useEffect, useState } from 'react';

/**
 * Themes shipped in src/index.css. Adding one = a [data-theme] block there,
 * its id here, and a label in common.json (theme.*).
 */
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** What the seller picked: a theme, or follow the OS. */
export type ThemePreference = Theme | 'system';
export const THEME_PREFERENCES = [
  'system',
  ...THEMES,
] as const satisfies readonly ThemePreference[];

/**
 * Stable contract: this key ships to sellers' browsers, and the inline script in
 * index.html reads it before first paint — rename both or neither.
 */
export const THEME_STORAGE_KEY = 'app.theme';

function isPreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    // Storage can be blocked (private mode, site data off); follow the OS.
    return 'system';
  }
}

function writeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Not persisted; the choice still applies for this session.
  }
}

export function resolveTheme(preference: ThemePreference): Theme {
  if (preference !== 'system') {
    return preference;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference);
}

/**
 * The seller's theme preference. Mount once, in the root layout: while the
 * preference is 'system' it also tracks OS light/dark changes.
 */
export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    writeThemePreference(next);
    setPreferenceState(next);
  }, []);

  return { preference, setPreference };
}
