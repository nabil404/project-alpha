# 06 · Settings – General

The shop's profile (name, logo, contact phone, pickup address) and its region
(country, currency, time zone, date format), so a shop can trade from any
country. The screens are the Settings – General artboards in the design
canvas. Data model:
[Merchant settings](../../mvp/01-messenger-to-order/domain.md#data-model).
This page describes what is built.

**Status (Oct 2026):** API built. The dashboard page at `/settings` is not
wired to it yet.

## Routes (session + TenantGuard unless noted)

| Route                                  | Request                                                                                                                                                     | Response                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /api/v1/settings/general`         | —                                                                                                                                                           | `GeneralSettings`                                                   |
| `PATCH /api/v1/settings/general`       | `{ name?, contactPhone?, pickupAddress?, country?, currency?, timeZone?, dateFormat? }`, strict. Omit to keep; blank or `null` clears the phone and address | 200 `GeneralSettings`; `409 CURRENCY_LOCKED` with `params.currency` |
| `PUT /api/v1/settings/general/logo`    | multipart, one `file`: JPEG, PNG or WebP, ≤ 5 MB, ≥ 256 × 256                                                                                               | `{ logo }`; `LOGO_*` errors as for the avatar                       |
| `DELETE /api/v1/settings/general/logo` | —                                                                                                                                                           | `{ logo: null }`                                                    |
| `PATCH /api/v1/account/preferences`    | `{ locale }`, one of `DASHBOARD_LOCALES` or `null`. Session only, no TenantGuard: it is the person's, not the shop's                                        | `{ locale }`; the session's `user.locale` carries it afterwards     |

`GeneralSettings` is `{ name, logo | null, contactPhone | null, pickupAddress | null, country, currency, timeZone, dateFormat, currencyLocked }`,
in [`packages/shared/src/schemas/settings.ts`](../../../packages/shared/src/schemas/settings.ts).
Everything regional is a code - ISO 3166 country, ISO 4217 currency, IANA zone

- and the dashboard localizes names with `Intl.DisplayNames`.

## Rules

- **Defaults.** A shop has no `merchant_settings` row until its first PATCH
  and reads as `regionDefaults(DEFAULT_COUNTRY)` (Bangladesh) until then.
  Picking a country changes nothing on the server by itself: the dashboard
  fills in `regionDefaults(country)` - currency, the capital's (or the main)
  time zone, a date format in the country's day/month order, the calling code -
  and the seller can change each before saving.
- **Accepted values** come from `@app/shared`'s region data, never a hand-kept
  list: `COUNTRY_CODES` (countries with a currency and a clock), `CURRENCY_CODES`
  (each country's everyday currency; fund codes like `USN` excluded),
  `TIME_ZONES` (canonical IANA ids plus `UTC`; aliases like `Asia/Calcutta` are
  refused), `DATE_FORMATS` (six date-fns patterns). An unknown value is
  `INVALID_INPUT` on its field.
- **Phone** is validated against the number's own country's plan
  (libphonenumber-js `max` metadata) and stored as E.164. Input must carry the
  `+` and country code; the form's calling code picker supplies it.
- **Currency** can change until the shop's first order, of any status, and is
  fixed after (`currencyLocked`). A change keeps each price's number: when the
  two currencies have different decimals, every variant price and delivery
  charge is rescaled (৳1,600.50 → ¥1,601) and each product's revision bumped.
  Nothing is converted at an exchange rate. The settings row is locked for the
  save, so the order work must read the currency it snapshots onto `order.currency`
  under the same row lock (`FOR SHARE`).
- **Logo** is normalized exactly like the profile photo (a 512 px square JPEG,
  metadata stripped) and stored at `o/<merchantId>/logo/<uuid>.jpg`, outside
  the product image sweep's `m/` prefix.
- **Dashboard language** is per person, on `user.locale`. Better Auth's
  `/update-user` refuses it; only `PATCH /account/preferences` sets it. Unset,
  the dashboard uses `defaultDashboardLocale(country)`. `DASHBOARD_LOCALES` is
  `['en']` until another translation exists.
- **Dates** render through `formatShopDate()` (date-fns + `@date-fns/tz`) in
  the shop's zone and format, never the viewer's machine's.

## Follow-ups

- Wire the dashboard page, and move `apps/web` money and date formatting onto
  the shop's settings (`SHOP_CURRENCY` is still hardcoded) and date-fns.
- Sign-up's `phoneSchema` still accepts any 7–15 digits as typed; move it to
  `e164PhoneSchema` with a calling code picker.
- Only the owner should change these once a shop has teammates; there is no
  role check yet.
