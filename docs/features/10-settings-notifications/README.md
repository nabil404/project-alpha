# 10 · Settings – Notifications

Which emails the signed-in person gets about the active shop: a new order
the assistant drafted, a customer waiting for them, and a daily summary.
The screens are the Settings – Notifications artboards in the design canvas.

**Status (Oct 2026):** the API stores and serves the switches, and the worker
sends all three emails. The daily summary goes out today; the other two
wait for the AI work to report their events (see [Follow-ups](#follow-ups)).
The page at `/settings/notifications` is not built.

## Routes (session + TenantGuard)

| Route                                  | Request                                                      | Response                   | Errors                  |
| -------------------------------------- | ------------------------------------------------------------ | -------------------------- | ----------------------- |
| `GET /api/v1/settings/notifications`   | —                                                            | `NotificationSettings`     | —                       |
| `PATCH /api/v1/settings/notifications` | any of `{ newOrder, customerWaiting, dailySummary }`, strict | 200 `NotificationSettings` | 400 `VALIDATION_FAILED` |

`NotificationSettings` is `{ newOrder, customerWaiting, dailySummary }`, all
booleans, in
[`packages/shared/src/schemas/notifications.ts`](../../../packages/shared/src/schemas/notifications.ts)
with `NOTIFICATION_DEFAULTS`.

## Rules

- **Per person, per shop.** The email goes to a person, so each member keeps
  their own switches, and a person in two shops has a set for each. The
  merchant comes from the session's active organization and the person from
  the session's user; neither is ever read from the request.
- **Defaults** until the first toggle: new order on, customer waiting on,
  daily summary off. Reading never writes a row.
- **Each switch saves on its own.** `PATCH` writes only the switches it was
  sent, so two quick toggles cannot undo each other; the first write fills
  the rest from the defaults. An empty body changes nothing and returns the
  current switches.
- **Email only.** There is no push channel in the MVP.
- **Recipients** (`NotificationPreferencesRepository.recipients`): the shop's
  members with the switch on, a member with no row counting as the default,
  and only verified addresses.

## Sending

Everything runs on the `notifications` queue, processed only by
`NotificationsProcessor` in the worker. An event job asks
`NotificationComposer` whether the email is still wanted and writes it, one
per recipient, reading in one short transaction under the shop's merchant
context. It then queues one `send-email` job per recipient, so a retried
event never mails anyone twice and a failed send (`MailService.send` throws)
retries alone. No mail call runs inside a transaction.

| Email                    | Reported by                                                                          | Job id                                      | Sent when the job runs if                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| New order drafted        | `NotificationsService.orderDrafted(merchantId, orderId)`, after the order commits    | `order-drafted-<orderId>`                   | The order exists and its `source` is `assistant`; one the seller added needs no email                                      |
| Customer waiting for you | `NotificationsService.handedOff(merchantId, conversationId, at)`, delayed 10 minutes | `customer-waiting-<conversationId>-<at ms>` | The chat is still `handed_off` and no `seller` message has been sent since `at`, from here or Facebook's inbox             |
| Daily summary            | The worker's `daily-summary-scan` scheduler, every 15 minutes (UTC)                  | `daily-summary-<merchantId>-<day>`          | It is 9:00-9:14 in the shop's time zone (the default region's with no settings row), and the shop placed an order that day |

- **Job ids** come from the event, so reporting it twice is a no-op while
  BullMQ keeps the job (an hour after it completes). Send jobs are
  `<event job id>-<userId>`. BullMQ refuses `:` in an id.
- **The daily summary** covers yesterday, shop time, with the day's
  boundaries computed by Postgres in that zone: how many orders were placed,
  and their total leaving out cancelled and returned ones. Every UTC offset
  is a multiple of 15 minutes, so each shop hits exactly one scan a day. The
  scan reads each shop's recipients first, and its time zone only if it has
  any.
- **Emails** are in English, link to the order, the conversation or the
  orders list on `APP_URL`, and end with a link to these settings. Amounts
  are in the order's or the shop's currency; the summary's date is in the
  shop's date format.

## Data model

`notification_preference`: `(merchant_id, user_id)` primary key,
`new_order`, `customer_waiting`, `daily_summary`. `user_id` cascades from
`user`, so a deleted person takes their switches with them; the columns have
no defaults, because the repository writes `NOTIFICATION_DEFAULTS` itself.
Migrations `0028_settings_notifications` and
`0029_notification_preference_force_rls`. Details in
[database.md](../../architecture/database.md).

## Code and tests

`apps/api/src/modules/settings/`: `NotificationSettingsService`,
`NotificationPreferencesRepository`, `notification-settings.controller.ts`.
`apps/api/src/modules/notifications/`: `NotificationsService` (in
`NotificationsModule`, imported by `AppModule`), and `NotificationComposer`,
`NotificationReadsRepository` and `NotificationsProcessor` (in
`NotificationsWorkerModule`, imported only by `WorkerModule`); the templates
in `notification-emails.ts`, the shop clock in `shop-clock.ts`.

| Spec                                                                                                                                                 | Covers                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`settings/__tests__/notification-settings.service.spec.ts`](../../../apps/api/src/modules/settings/__tests__/notification-settings.service.spec.ts) | Defaults, partial updates, two members of one shop, one person in two shops, another shop's rows, recipients, RLS               |
| [`settings/__tests__/notification-settings.e2e.spec.ts`](../../../apps/api/src/modules/settings/__tests__/notification-settings.e2e.spec.ts)         | The routes over HTTP and their errors                                                                                           |
| [`notifications/__tests__/notification-composer.spec.ts`](../../../apps/api/src/modules/notifications/__tests__/notification-composer.spec.ts)       | Each email's conditions against the database: seller orders, replies, state, switches, time zones, day boundaries, another shop |
| [`notifications/__tests__/notifications.processor.spec.ts`](../../../apps/api/src/modules/notifications/__tests__/notifications.processor.spec.ts)   | Routing, the scheduler, send-job ids, a failed send throwing                                                                    |
| [`notifications/__tests__/notifications.service.spec.ts`](../../../apps/api/src/modules/notifications/__tests__/notifications.service.spec.ts)       | Job ids and the 10-minute delay                                                                                                 |
| [`notifications/__tests__/shop-clock.spec.ts`](../../../apps/api/src/modules/notifications/__tests__/shop-clock.spec.ts)                             | Shop-local time, the 9:00 scan, a 45-minute offset, daylight saving                                                             |
| [`notifications/__tests__/notification-emails.spec.ts`](../../../apps/api/src/modules/notifications/__tests__/notification-emails.spec.ts)           | Links, HTML escaping, wording                                                                                                   |

## Follow-ups

- **The page** at `/settings/notifications`, with "New order drafted" worded
  as email only (the design says "A push and email").
- **Reporting the two events**, part of the AI work:
  - call `NotificationsService.orderDrafted` after the transaction that
    writes a `source = assistant` order commits;
  - call `NotificationsService.handedOff` after the transaction that moves a
    conversation into `handed_off` commits, with the moment it did.
- **Emails in the reader's language**, once the dashboard speaks more than
  English.
- **The daily summary** is outside MVP 01's scope; it is built because the
  design has its switch.
