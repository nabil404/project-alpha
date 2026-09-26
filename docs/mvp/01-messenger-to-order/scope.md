# Scope

## In scope

- Seller authentication (Better Auth): email/password with email verification
  and password reset, Google sign-in, Facebook sign-in. Google accounts link to
  existing accounts by verified email; Facebook accounts link only explicitly
  from account settings, since Facebook does not guarantee a verified email.
- Connect Facebook Page: a separate step after sign-in that requests Page
  permissions. Facebook sign-in itself requests only `public_profile` and
  `email`.
- Product catalog: products, aliases, variants, prices, images, stock status,
  delivery charges, CSV import.
- AI: intent classification, product matching, slot-filling, confirmation,
  mid-flow edits.
- Automatic order creation with the order ID sent to the customer.
- Human handoff, and bot auto-pause when the seller replies manually.
- Seller dashboard: orders list and detail with transcript, status changes,
  edits, notes, Needs Attention queue, conversation viewer, bot on/off toggle,
  CSV export.
- Email notifications for new orders and handoffs.
- Responsive web dashboard.

## Out of scope (Post-MVP Backlog)

Instagram, WhatsApp, website chat; online payments (assume cash on delivery or
manual confirmation); courier integrations and external inventory sync;
multi-user team roles and mobile apps; image/screenshot product matching, stats
page, post-order status messages, comment-to-Messenger replies, abandoned-chat
follow-ups, repeat-customer recognition.

"Multi-user team roles" above means several users inside one organization. It is
not the same thing as several organizations per seller, which the data model
already allows ([Domain](domain.md#data-model)); only the switcher for it is
deferred.
