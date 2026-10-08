# 11.9 · Mentions and visitor posts

**Status:** not started.

## Goal

When someone mentions or tags the Page, or posts on the Page itself, the seller
sees it in the dashboard. These are mostly support questions and complaints, so
the assistant does not reply on its own.

## Depends on

[Phase 7](../phase-7-comments-to-messenger/README.md): the `feed` webhook and
its dedupe.

## Scope

- **Webhook.** `mention` for tags in other people's posts and comments; `feed`
  with visitor posts (`item = post` by someone other than the Page).
- **Store** a `page_mention` row (merchant_id, page_id, kind, author name,
  permalink, text excerpt, created_at, handled) with RLS. Keep only what the
  dashboard shows.
- **Dashboard.** A list with an unhandled count in the sidebar; each item opens
  on Facebook; the seller marks it handled. A visitor post that looks like a
  complaint also appears in Needs Attention.
- **No auto-reply.** The seller answers on Facebook. A "Message this person"
  action is a later idea, not this phase.

## Meta / App Review

`mention` and `feed` webhook fields; `pages_read_user_content` (and
`pages_read_engagement`), requested in the Week 4 App Review.

## Rules it must keep

Each seller sees only their own Pages' mentions. Webhooks verified and
deduplicated. No message text in logs.

## Tests

- The same mention twice → stored once.
- The Page's own posts are not listed as visitor posts.
- Two-merchant isolation for `page_mention`.

## Done when

- A mention and a visitor post on the dev Page appear in the dashboard and can
  be marked handled.
