import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { defaultNS, namespaces, resources, supportedLanguages } from './resources';

/**
 * Stable contract: this key ships to sellers' browsers, so renaming it later
 * silently resets everyone's saved preference.
 */
export const LANGUAGE_STORAGE_KEY = 'app.language';

/** Keeps <html lang> and the tab title on the language the copy is actually in. */
function syncDocumentLanguage(): void {
  document.documentElement.lang = i18n.resolvedLanguage ?? i18n.language;
  document.title = i18n.t('app.title');
}

// Guarded so a Vite HMR re-evaluation of this module can't re-register the
// plugins or stack a second languageChanged listener on the same singleton.
if (!i18n.isInitialized) {
  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init(
      {
        resources,
        defaultNS,
        ns: [...namespaces],
        fallbackLng: 'en',
        supportedLngs: [...supportedLanguages],
        // Keeps 'en-GB' as the active tag — Intl wants the region for money and
        // dates — while translations still resolve to 'en'.
        nonExplicitSupportedLngs: true,
        detection: {
          // 'querystring' first is for QA: ?lng=xx exercises a new locale
          // before any switcher UI exists.
          order: ['querystring', 'localStorage', 'navigator'],
          caches: ['localStorage'],
          lookupLocalStorage: LANGUAGE_STORAGE_KEY,
        },
        // React escapes interpolated values already; escaping twice mangles '&'.
        interpolation: { escapeValue: false },
        // Resources are bundled, so init completes synchronously and the first
        // render already has them. (v26 renamed initImmediate -> initAsync.)
        initAsync: false,
        react: { useSuspense: false },
      },
      () => {
        i18n.on('languageChanged', syncDocumentLanguage);
        syncDocumentLanguage();
      },
    );
}

export default i18n;
