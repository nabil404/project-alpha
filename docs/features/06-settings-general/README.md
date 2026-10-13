# 06 · Settings – General

The shop's profile (name, logo, contact phone, pickup address) and its region
(country, currency, time zone, date format). Data model:
[Merchant settings](../../mvp/01-messenger-to-order/domain.md#data-model).

**Status (Oct 2026):** built in the API and at `/settings/general`, where
Settings opens. Money and dates on every dashboard page follow the shop's
region through `ShopRegionProvider` in `apps/web/src/features/settings`.

## Routes (session + TenantGuard unless noted)

| Route                                  | Request                                                                                                                                          | Response                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/settings/general`         | none                                                                                                                                             | `GeneralSettings`                                                                                                               |
| `PATCH /api/v1/settings/general`       | `{ name?, contactPhone?, pickupAddress?, country?, currency?, timeZone?, dateFormat? }`, strict. Blank or `null` clears phone/address            | 200 `GeneralSettings`; 400 `VALIDATION_FAILED`; 409 `CURRENCY_LOCKED` with `params.currency`                                    |
| `PUT /api/v1/settings/general/logo`    | multipart, one `file`: JPEG, PNG or WebP, ≤ 5 MB, ≥ 256 × 256                                                                                    | `{ logo }`; 400 `LOGO_INVALID` / `LOGO_TOO_SMALL`, 413 `LOGO_TOO_LARGE`, 415 `LOGO_UNSUPPORTED_TYPE`, 503 `STORAGE_UNAVAILABLE` |
| `DELETE /api/v1/settings/general/logo` | none                                                                                                                                             | `{ logo: null }`                                                                                                                |
| `PATCH /api/v1/account/preferences`    | `{ locale }`, one of `DASHBOARD_LOCALES` or `null`. Session only, since it is the person's setting ([Account](../08-settings-account/README.md)) | `{ locale }`                                                                                                                    |

`GeneralSettings` is `{ name, logo | null, contactPhone | null, pickupAddress | null, country, currency, timeZone, dateFormat, currencyLocked }`,
in [`packages/shared/src/schemas/settings.ts`](../../../packages/shared/src/schemas/settings.ts).
Regional values are codes (ISO 3166 country, ISO 4217 currency, IANA zone).
The dashboard names them with `Intl.DisplayNames`.

## Rules

- **Defaults.** On an email sign-up, `seedRegionFromPhone` sets the region
  from the seller's phone, so a +1 212 number opens in USD,
  America/New_York and month-first dates. It never overwrites an existing
  row and never fills the contact phone. If it fails, the hook logs a warning
  and sign-up still succeeds. A shop with no row reads as
  `regionDefaults(DEFAULT_COUNTRY)` (Bangladesh) until its first PATCH.
- **Picking a country** in the dashboard fills in `regionDefaults(country)`:
  currency, time zone, date format and calling code. The seller can change
  each before saving. The server sees only what is saved.
- **Accepted values** come from `@app/shared`'s region data: `COUNTRY_CODES`,
  `CURRENCY_CODES` (everyday currencies, no fund codes such as `USN`),
  `TIME_ZONES` (canonical IANA ids plus `UTC`, so `Asia/Calcutta` is refused)
  and `DATE_FORMATS` (six date-fns patterns). An unknown value is
  `400 VALIDATION_FAILED` with field code `INVALID_INPUT`.
- **Contact phone** must start with `+` and the country code. It is checked
  against that country's numbering plan (libphonenumber-js) and stored as
  E.164.
- **Currency** can change until the shop's first order, of any status
  (`currencyLocked`). A change keeps each price's number and converts nothing.
  When the currencies have different decimals, `rescaleAmounts` rescales every
  variant price, delivery charge and the free-delivery threshold (৳1,600.50
  becomes ¥1,601) and bumps each product's revision. The PATCH locks the
  `merchant_settings` row, and order creation takes the same lock before it
  copies the currency onto the order ([Orders](../07-orders/README.md#rules)),
  so a currency change and a first order cannot interleave.
- **Logo** goes through the same processing as the
  [profile photo](../08-settings-account/README.md#rules): a 512 px square
  JPEG without metadata, stored at `o/<merchantId>/logo/<uuid>.jpg`. The `o/`
  prefix keeps it out of the product image sweep, which lists `m/`. The URL
  is saved on `organization.logo`.
- **Dashboard language** is per person, on `user.locale`, and only
  `PATCH /account/preferences` sets it (Better Auth's `/update-user` refuses
  it). Unset, the dashboard uses `defaultDashboardLocale(country)`.
  `DASHBOARD_LOCALES` is `['en']` until another translation exists.
- **Dates** render through `formatShopDate()` (date-fns and `@date-fns/tz`) in
  the shop's zone and format, not the viewer's.

## Dashboard

- **Shop profile card:** logo (checked in the browser before upload), name,
  contact phone and pickup address. The phone field is a searchable calling
  code picker plus the national number, sent as one E.164 string.
- **Region card:** searchable pickers for country (it also matches names such
  as "USA"), currency and time zone (the country's zones first, each with its
  GMT offset), a date format list that previews today, and the person's
  language. A currency change warns that prices keep their numbers; a locked
  currency says why.
- **Other pages** format through `useFormatters()`, which reads the shop's
  region: money in the shop's currency, dates in its zone and format, and
  conversation day separators at the shop's midnight. A currency change
  refetches every cached amount.

## Data model

`merchant_settings`
([`schema/settings.ts`](../../../apps/api/src/modules/database/schema/settings.ts)),
one row per shop keyed by `merchant_id`: `country`, `currency`, `time_zone`,
`date_format`, `contact_phone` (E.164), `pickup_address`, and
`free_delivery_over` ([Delivery](../09-settings-delivery/README.md)). Checks
pin the shape of each code; `@app/shared` decides which codes exist. RLS is
enabled and forced with `merchant_settings_merchant_isolation`. The name and
logo live on Better Auth's `organization` row, read and written by
[`shop-profile.repository.ts`](../../../apps/api/src/modules/settings/shop-profile.repository.ts).

## Code and tests

`apps/api/src/modules/settings/`: `GeneralSettingsService` (the PATCH, the
currency lock and the rescale), `MerchantSettingsRepository`,
`region-from-phone.ts` (the sign-up seed) and `logo/`.

- `__tests__/general-settings.service.spec.ts`
- `__tests__/general-settings.e2e.spec.ts`: over HTTP.
- `__tests__/region.spec.ts`: the region data.
- `logo/__tests__/logo-keys.spec.ts`

Web: `apps/web/src/features/settings/` and
`apps/web/src/routes/_app/settings/general.tsx`.

## Follow-ups

- Once a shop has teammates, only the owner should change these settings.
  Nothing checks roles yet.
