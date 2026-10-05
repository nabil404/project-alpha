# 06 · Settings – General

The shop's profile (name, logo, contact phone, pickup address) and its region
(country, currency, time zone, date format), so a shop can trade from any
country. The screens are the Settings – General artboards in the design
canvas. Data model:
[Merchant settings](../../mvp/01-messenger-to-order/domain.md#data-model).
This page describes what is built.

**Status (Oct 2026):** built end to end: the API, and the dashboard page at
`/settings/general` (Settings now opens on it). Every page's money and dates
follow the shop's region through `ShopRegionProvider` in
`apps/web/src/features/settings`.

## Routes (session + TenantGuard unless noted)

| Route                                  | Request                                                                                                                                                                            | Response                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/settings/general`         | —                                                                                                                                                                                  | `GeneralSettings`                                                                                                               |
| `PATCH /api/v1/settings/general`       | `{ name?, contactPhone?, pickupAddress?, country?, currency?, timeZone?, dateFormat? }`, strict. Omit to keep; blank or `null` clears the phone and address                        | 200 `GeneralSettings`; `409 CURRENCY_LOCKED` with `params.currency`                                                             |
| `PUT /api/v1/settings/general/logo`    | multipart, one `file`: JPEG, PNG or WebP, ≤ 5 MB, ≥ 256 × 256                                                                                                                      | `{ logo }`; 400 `LOGO_INVALID` / `LOGO_TOO_SMALL`, 413 `LOGO_TOO_LARGE`, 415 `LOGO_UNSUPPORTED_TYPE`, 503 `STORAGE_UNAVAILABLE` |
| `DELETE /api/v1/settings/general/logo` | —                                                                                                                                                                                  | `{ logo: null }`                                                                                                                |
| `PATCH /api/v1/account/preferences`    | `{ locale }`, one of `DASHBOARD_LOCALES` or `null`. Session only, no TenantGuard: it is the person's, not the shop's ([08 · Settings – Account](../08-settings-account/README.md)) | `{ locale }`; the session's `user.locale` carries it afterwards                                                                 |

`GeneralSettings` is `{ name, logo | null, contactPhone | null, pickupAddress | null, country, currency, timeZone, dateFormat, currencyLocked }`,
in [`packages/shared/src/schemas/settings.ts`](../../../packages/shared/src/schemas/settings.ts).
Everything regional is a code (ISO 3166 country, ISO 4217 currency, IANA
zone), and the dashboard localizes names with `Intl.DisplayNames`.

## Rules

- **Defaults.** An email sign-up starts the shop in the region of the
  seller's phone (`seedRegionFromPhone`, from the sign-up hook): a +1 212
  number opens in USD, America/New_York and month-first dates. It never
  overwrites an existing row, never fills in the contact phone (the seller's
  number isn't necessarily the one customers should see), and a failure only
  logs; sign-up still succeeds. A shop with no row (a social sign-up, or
  one from before this) reads as `regionDefaults(DEFAULT_COUNTRY)`
  (Bangladesh) until its first PATCH.
  Picking a country changes nothing on the server by itself: the dashboard
  fills in `regionDefaults(country)` (currency, the capital's or the main
  time zone, a date format in the country's day/month order, the calling
  code), and the seller can change each before saving.
- **Accepted values** come from `@app/shared`'s region data, never a hand-kept
  list: `COUNTRY_CODES` (countries with a currency and a clock), `CURRENCY_CODES`
  (each country's everyday currency; fund codes like `USN` excluded),
  `TIME_ZONES` (canonical IANA ids plus `UTC`; aliases like `Asia/Calcutta` are
  refused), `DATE_FORMATS` (six date-fns patterns). An unknown value is
  `400 VALIDATION_FAILED` with field code `INVALID_INPUT`.
- **Phone** is validated against the number's own country's plan
  (libphonenumber-js `max` metadata) and stored as E.164. Input must carry the
  `+` and country code; the form's calling code picker supplies it.
- **Currency** can change until the shop's first order, of any status, and is
  fixed after (`currencyLocked`). A change keeps each price's number: when the
  two currencies have different decimals, every variant price and delivery
  charge is rescaled (৳1,600.50 → ¥1,601) and each product's revision bumped.
  Nothing is converted at an exchange rate. The settings row is locked for the
  save, and order creation takes the same row's lock before it snapshots the
  currency onto `order.currency`
  ([Orders](../07-orders/README.md#rules)), so a currency change and a first
  order can't cross.
- **Logo** is normalized exactly like the
  [profile photo](../08-settings-account/README.md#rules) (a 512 px square
  JPEG, metadata stripped) and stored at `o/<merchantId>/logo/<uuid>.jpg`,
  outside the product image sweep's `m/` prefix. Its URL is `organization.logo`.
- **Dashboard language** is per person, on `user.locale`. Better Auth's
  `/update-user` refuses it; only `PATCH /account/preferences` sets it. Unset,
  the dashboard uses `defaultDashboardLocale(country)`. `DASHBOARD_LOCALES` is
  `['en']` until another translation exists.
- **Dates** render through `formatShopDate()` (date-fns + `@date-fns/tz`) in
  the shop's zone and format, never the viewer's machine's.

## Dashboard

- **Shop profile card:** logo (same checks as the profile photo, before
  upload), name, contact phone and pickup address. The phone is a searchable
  calling code picker plus the national number, emitted as one E.164 string;
  a saved number reads back in national format under its own country's code.
- **Region card:** searchable pickers for country (matches other names, such
  as "USA"), currency and time zone (the country's own zones first, each with
  its current GMT offset), a date format list previewing today's date, and the
  person's dashboard language. Picking a country fills in its currency (unless
  locked), time zone and date format. A changed currency warns that prices
  keep their numbers; a locked one says why it can't change. Names come from
  `Intl.DisplayNames` in the dashboard's language.
- **Everywhere else:** `useFormatters()` reads the shop's region:
  `formatMoney` defaults to the shop's currency, dates render with date-fns
  in the shop's zone and format, and the conversation day separators and
  "today" checks use the shop's midnight. A currency change refetches every
  cached amount. The dashboard switches to the person's language, or the
  shop country's, when one is set.

## Data model

`merchant_settings`
([`schema/settings.ts`](../../../apps/api/src/modules/database/schema/settings.ts)):
one row per shop, keyed by `merchant_id`, with `country`, `currency`,
`time_zone`, `date_format`, `contact_phone` (E.164, checked) and
`pickup_address`. Checks pin the shape of the codes; which ones exist is
`@app/shared`'s to say. RLS enabled and forced with
`merchant_settings_merchant_isolation`. The shop's name and logo stay on
Better Auth's `organization` row
([`shop-profile.repository.ts`](../../../apps/api/src/modules/settings/shop-profile.repository.ts)).

## Code and tests

`apps/api/src/modules/settings/`: `GeneralSettingsService` (the PATCH, the
currency lock and rescale), `MerchantSettingsRepository`, `region-from-phone.ts`
(the sign-up seed) and `logo/`. Tests:
`__tests__/general-settings.service.spec.ts`,
`__tests__/general-settings.e2e.spec.ts` (over HTTP), `__tests__/region.spec.ts`
(the region data) and `logo/__tests__/logo-keys.spec.ts`. Web:
`apps/web/src/features/settings/`, route
`apps/web/src/routes/_app/settings/general.tsx`.

## Follow-ups

- Only the owner should change these once a shop has teammates; there is no
  role check yet.
