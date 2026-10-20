# 10 · Settings – Notifications

Which emails the signed-in person gets about the active shop: a new order the
assistant drafted, a customer waiting for them, a daily summary, and an
import from Facebook posts that ended.

**Status (Oct 2026):** built. The API stores the switches, the worker sends
all four emails, and the page is at `/settings/notifications`. The page does
not show the fourth switch, **Import finished**, yet
([Follow-ups](#follow-ups)). The assistant
reports hand-offs since
[phase 11.1](../11-ai-implementation/phase-1-foundation/README.md) and
drafted orders since
[phase 11.2](../11-ai-implementation/phase-2-catalog-confirm-orders/README.md#confirm).

[Sending flow](sending-flow.md) draws how an event becomes emails.

## Routes (session + TenantGuard)

| Route                                  | Request                                                                      | Response                   | Errors                  |
| -------------------------------------- | ---------------------------------------------------------------------------- | -------------------------- | ----------------------- |
| `GET /api/v1/settings/notifications`   | none                                                                         | `NotificationSettings`     | none                    |
| `PATCH /api/v1/settings/notifications` | any of `{ newOrder, customerWaiting, dailySummary, importFinished }`, strict | 200 `NotificationSettings` | 400 `VALIDATION_FAILED` |

`NotificationSettings` is `{ newOrder, customerWaiting, dailySummary, importFinished }`,
all booleans, in
[`packages/shared/src/schemas/notifications.ts`](../../../packages/shared/src/schemas/notifications.ts)
with `NOTIFICATION_DEFAULTS`.

## Rules

- **Per person, per shop.** Each member keeps their own switches, and a
  person in two shops has a set for each. The merchant comes from the
  session's active organization and the person from the session's user,
  never from the request.
- **Defaults** apply until the first toggle: new order on, customer waiting
  on, daily summary off, import finished on. Reading never writes a row.
- **Each switch saves on its own.** `PATCH` writes only the switches it was
  sent, so two quick toggles cannot undo each other. The first write fills
  the rest from the defaults. An empty body changes nothing.
- **Email only.** The MVP has no push channel.
- **Recipients** (`NotificationPreferencesRepository.recipients`) are the
  shop's members with the switch on, counting a member with no row as the
  default, and only with a verified email.

## Sending

The `notifications` queue carries every job, and only `NotificationsProcessor`
in the worker consumes it. An event job asks `NotificationComposer` whether
the email is still wanted and builds one per recipient, in one short
transaction under the shop's merchant context. It then queues one
`send-email` job per recipient. A retried event therefore mails nobody twice,
and a failed send retries alone. No mail call runs inside a transaction.

| Email                    | Reported by                                                                           | Job id                                      | Sent if, when the job runs                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New order drafted        | `NotificationsService.orderDrafted(merchantId, orderId)`, after the order commits     | `order-drafted-<orderId>`                   | The order exists and its `source` is `assistant`                                                                                                             |
| Customer waiting for you | `NotificationsService.handedOff(merchantId, conversationId, at)`, delayed 10 minutes  | `customer-waiting-<conversationId>-<at ms>` | The chat is still `handed_off`, `handed_off_at` still equals `at`, and no `seller` message (from the dashboard or Facebook's inbox) has been sent since `at` |
| Daily summary            | The `daily-summary-scan` scheduler, every 15 minutes in UTC                           | `daily-summary-<merchantId>-<day>`          | The scan was scheduled for 9:00–9:14 in the shop's time zone, and the shop had an order that day that is not cancelled or returned                           |
| Import finished          | `NotificationsService.importFinished(merchantId, importId, endedAt)`, when a run ends | `import-finished-<importId>-<endedAt ms>`   | The run is still `finished`, `stopped` or `failed`, and its `finished_at` still equals `endedAt`; a run resumed since has moved on from that end             |

- **Job ids** come from the event, so reporting an event twice is a no-op
  while BullMQ keeps the job. Event jobs use `EVENT_JOB_RETENTION`, which
  keeps them a week after they complete, by age only; the queue's default
  also caps completed jobs at a count that every send shares. Send jobs are
  `<event job id>-<userId>` with the default retention. BullMQ refuses `:` in
  an id.
- **The daily summary** covers yesterday in shop time: how many orders were
  placed and their total, leaving out cancelled and returned ones. Postgres
  computes the day's boundaries in the shop's zone. Every UTC offset is a
  multiple of 15 minutes, so exactly one scan a day lands in a shop's
  9:00–9:14. The scan judges the time it was scheduled for
  (`opts.prevMillis`), not when a worker picked it up, so a delayed scan
  still finds its shops. It reads each shop's time zone, and reads recipients
  only for shops at their 9:00. A shop with no settings row uses the default
  region.
- **The import email** says the posts' dates in the shop's date format, how
  many drafts the run made and how many still need a price, or why it failed
  (`FACEBOOK_PERMISSION_MISSING`, `FACEBOOK_UNAVAILABLE` or
  `IMPORT_NOT_AVAILABLE`), and links to `/catalog/imports/:id`
  ([Import from Facebook posts](../13-facebook-post-import/README.md#the-finished-email)).
- **Emails** are in English. They link to the order, the conversation, the
  import or the orders list on `APP_URL`, and end with a link to these settings. Amounts
  use the order's or the shop's currency, and the summary's date uses the
  shop's date format.

## Dashboard

`/settings/notifications` has one card with a switch and hint per email, in
the design's order. A switch saves as soon as it flips:

- the cache takes the change at once and a success toast confirms it;
- a failed save puts that switch back and shows an `ErrorBanner` in the card,
  even when a later toggle is in flight, and the next toggle clears it;
- only the last of several quick toggles refetches, so an earlier response
  cannot flip a switch back.

`Switch` (`components/ui/switch.tsx`) uses the accent track and `on-accent`
thumb when on.

## Data model

`notification_preference`: primary key `(merchant_id, user_id)`, plus
`new_order`, `customer_waiting`, `daily_summary` and `import_finished`.
`user_id` cascades from `user`. The columns have no defaults, because the
repository writes `NOTIFICATION_DEFAULTS` itself; `import_finished` defaults
to `true` only so migration `0049_product_import` could add it to existing
rows. Migrations `0028_settings_notifications` and
`0029_notification_preference_force_rls` create the table. The customer-waiting
email also reads `conversation.handed_off_at`
([Conversations](../04-conversations/README.md#data-model)), from
`0030_conversation_handed_off_at`. See
[database.md](../../architecture/database.md).

## Code and tests

- `apps/api/src/modules/settings/`: `NotificationSettingsService`,
  `NotificationPreferencesRepository` and `notification-settings.controller.ts`.
- `apps/api/src/modules/notifications/`:
  - `NotificationsService`, in `NotificationsModule`, which `AppModule`
    imports;
  - `NotificationComposer`, `NotificationReadsRepository` and
    `NotificationsProcessor`, in `NotificationsWorkerModule`, which only
    `WorkerModule` imports;
  - `notification-emails.ts`, the templates, rendered through the shared MJML
    templates in `mail/templates.ts`
    ([Auth](../01-auth/README.md#email-and-password-flows));
  - `shop-clock.ts`, the shop's local time.
- Web: `features/settings/components/NotificationsCard.tsx`,
  `features/settings/notification-queries.ts` and `components/ui/switch.tsx`,
  under `apps/web/src/`.

| Spec                                                                                                                                                 | Covers                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`settings/__tests__/notification-settings.service.spec.ts`](../../../apps/api/src/modules/settings/__tests__/notification-settings.service.spec.ts) | Defaults, partial updates, two members of one shop, one person in two shops, another shop's rows, recipients, RLS               |
| [`settings/__tests__/notification-settings.e2e.spec.ts`](../../../apps/api/src/modules/settings/__tests__/notification-settings.e2e.spec.ts)         | The routes over HTTP and their errors                                                                                           |
| [`notifications/__tests__/notification-composer.spec.ts`](../../../apps/api/src/modules/notifications/__tests__/notification-composer.spec.ts)       | Each email's conditions against the database: seller orders, replies, state, switches, time zones, day boundaries, another shop |
| [`notifications/__tests__/notifications.processor.spec.ts`](../../../apps/api/src/modules/notifications/__tests__/notifications.processor.spec.ts)   | Routing, the scheduler, the scan's scheduled time, send-job ids, a failed send throwing                                         |
| [`notifications/__tests__/notifications.service.spec.ts`](../../../apps/api/src/modules/notifications/__tests__/notifications.service.spec.ts)       | Job ids, their retention and the 10-minute delay                                                                                |
| [`notifications/__tests__/shop-clock.spec.ts`](../../../apps/api/src/modules/notifications/__tests__/shop-clock.spec.ts)                             | Shop-local time, the 9:00 scan, a 45-minute offset, daylight saving                                                             |
| [`notifications/__tests__/notification-emails.spec.ts`](../../../apps/api/src/modules/notifications/__tests__/notification-emails.spec.ts)           | Links, HTML escaping, wording                                                                                                   |

## Follow-ups

- The fourth switch, **Import finished**, on `/settings/notifications` and
  the canvas's Notifications screens.
- Send emails in the reader's language once the dashboard has more than
  English.
- The daily summary is outside MVP 01's scope. It exists because the design
  has its switch.
