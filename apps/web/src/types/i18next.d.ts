// Augments i18next — NOT react-i18next, which only re-exports CustomTypeOptions,
// so declaring the module there is a silent no-op.
import 'i18next'; // makes this file a module → augmentation, not a redeclaration

import type { defaultNS, resources } from '@/i18n/resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)['en'];
    // i18next v26 defaults `enableSelector` to true and v27 tentatively
    // deprecates string keys at the type level. The maps in i18n/status-keys.ts
    // pass keys around as strings, so pin this rather than inherit a default
    // that can move under us on a minor bump.
    enableSelector: false;
    // A key that doesn't exist, or that resolves to an object, is an error —
    // and t() returns `string`, never `string | undefined`.
    strictKeyChecks: true;
  }
}
