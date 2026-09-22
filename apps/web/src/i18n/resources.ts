import catalog from './locales/en/catalog.json';
import common from './locales/en/common.json';
import errors from './locales/en/errors.json';
import orders from './locales/en/orders.json';

/** Adding a namespace: import the JSON, add it to `resources.en` and to `namespaces`. */
export const namespaces = ['common', 'orders', 'catalog', 'errors'] as const;

export const defaultNS = 'common';

/** Adding a locale: add `locales/<lng>/*.json`, one entry here, one in `supportedLanguages`. */
export const resources = {
  en: { common, orders, catalog, errors },
} as const;

export const supportedLanguages = ['en'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];
