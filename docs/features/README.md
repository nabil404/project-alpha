# Features

How each built feature works: routes, rules, data model, dashboard, tests and
what is left. _What_ an MVP builds and _why_ lives in [`docs/mvp/`](../mvp/README.md),
which wins on any conflict; these pages describe what the code does. Update a
feature's page in the same change as its code.

| #   | Feature                                                         | Status (Oct 2026)                                                                   |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 01  | [Authentication](01-auth/README.md)                             | Built: email/password, Google, Facebook, organizations, tenant guard                |
| 02  | [Product catalog](02-catalog/README.md)                         | Built, except CSV import                                                            |
| 03  | [Connect Facebook Page](03-facebook-page/README.md)             | Built, except the bot on/off toggle                                                 |
| 04  | [Conversations](04-conversations/README.md)                     | Built: webhook, ingest, inbox, replies, SSE. Assistant replies wait for the AI work |
| 05  | [Customers](05-customers/README.md)                             | Built, except export                                                                |
| 06  | [Settings – General](06-settings-general/README.md)             | Built                                                                               |
| 07  | [Orders](07-orders/README.md)                                   | Built, except CSV export and the Messenger order summary                            |
| 08  | [Settings – Account](08-settings-account/README.md)             | Built                                                                               |
| 09  | [Settings – Delivery charges](09-settings-delivery/README.md)   | Built; the assistant quoting delivery waits for the AI work                         |
| 10  | [Settings – Notifications](10-settings-notifications/README.md) | Built; the AI work reporting orders and handoffs is not                             |
| 11  | [AI implementation](11-ai-implementation/README.md)             | Not started: nine phases, from the assistant's turn to comments and Live sales      |

## Each page

Status, then the routes with their request and response shapes, the rules,
the data model, errors, the dashboard, code and tests, and the follow-ups that
are left. A page links to another rather than repeating it.

## MVP scope not yet built

In [MVP 01's scope](../mvp/01-messenger-to-order/scope.md) or
[Meta requirements](../mvp/01-messenger-to-order/meta-requirements.md), with no
feature page because no code exists yet:

- **The AI assistant**, planned phase by phase in
  [AI implementation](11-ai-implementation/README.md): intent classification, product matching from
  `findSellableCatalog`, slot-filling, the confirmation card, mid-flow edits,
  handoff when unsure or when the LLM fails, and writing `source = assistant`
  orders with the order ID sent to the customer. Its hooks are listed in
  [Conversations](04-conversations/README.md#follow-ups),
  [Catalog](02-catalog/README.md#not-yet-built) and
  [Orders](07-orders/README.md#follow-ups).
- **Reporting new orders and handoffs** for the seller's emails: the
  sending is built
  ([Settings – Notifications](10-settings-notifications/README.md#sending)),
  and the AI work calls it.
- **Needs Attention queue** on the dashboard. Today "Needs you" exists as a
  conversation filter and a customer status, and drafted orders as an Orders
  tab and banner.
- **Bot on/off toggle** ([Page](03-facebook-page/README.md#follow-ups)).
- **CSV import** of products and **CSV export** of orders.
- **Overview page**: `/` redirects to `/orders` until it exists.
- **Privacy policy, terms and data deletion** that Meta requires.
  `docker/Caddyfile` already routes `/privacy`, `/terms` and `/data-deletion`
  to `/legal/*.html`, but no such files exist yet, and there is no data
  deletion callback endpoint. The sign-up form links to `/terms` and
  `/privacy` ([Auth](01-auth/README.md#not-yet-built)).
