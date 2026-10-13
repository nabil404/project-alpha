# 11.9 · Mentions and visitor posts

**Status:** not started ([progress](../progress.md)).

## Goal

When someone mentions or tags the Page, or posts on it, the seller sees it in
the dashboard. These are mostly support questions and complaints, so the
assistant does not reply.

## Depends on

[Phase 7](../phase-7-comments-to-messenger/README.md): the `feed` webhook and
its dedupe.

## Scope

- **Webhook.** `mention` for tags in other people's posts and comments, and
  `feed` for visitor posts (`item = post` by someone other than the Page).
- **Store** a `page_mention` row (`merchant_id`, `page_id`, kind, author name,
  permalink, text excerpt, `created_at`, handled) with RLS, keeping only what
  the dashboard shows.
- **Dashboard.** A list with an unhandled count in the sidebar; each item
  opens on Facebook, and the seller marks it handled. A visitor post that
  looks like a complaint should also reach the Needs Attention queue, once
  that exists.
- **No auto-reply.** The seller answers on Facebook. "Message this person" is
  a later idea.

## Meta / App Review

The `mention` and `feed` fields, and `pages_read_user_content` (with
`pages_read_engagement`), in the Week 4 submission.

## Rules it must keep

Each seller sees only their own Pages' mentions. Webhooks verified and
deduplicated. No message text in logs.

## Tests

- The same mention twice is stored once.
- The Page's own posts are not listed as visitor posts.
- Two-merchant isolation for `page_mention`.

## Done when

- [ ] A mention and a visitor post on the dev Page appear in the dashboard
      and can be marked handled.
