# Meta requirements

What Meta requires of the MVP. How to set up the apps, permissions and
webhooks: [Meta setup](../../setup/meta-setup.md).

- Business Verification — start Week 1.
- App Review for advanced access — submit by end of Week 4, one screencast per
  permission. Check names against Meta's current docs before submitting:
  - `pages_messaging` — the assistant's replies and the Confirm flow.
  - `pages_read_engagement` — reading Page posts linked to products, and the
    post picker.
  - `pages_read_user_content` — comments, mentions and visitor posts.
  - `pages_manage_engagement` — public replies to comments.

  `pages_show_list` and `pages_manage_metadata` (Page connection and webhook
  subscription) are requested alongside. A rejection drops only the
  [AI phases](../../features/11-ai-implementation/README.md#app-review) that
  need that permission.

- Page webhook fields: `messages`, `messaging_postbacks`, `message_echoes`,
  `messaging_referrals`, `message_reactions`, `message_edits`, `feed`,
  `mention`. Pages connected before a field is added must resubscribe.
- Messenger Profile (Get Started, ice breakers, persistent menu, greeting) is
  set through the Page token when the Page is connected.
- Private replies to comments: one per comment, within Meta's time limit.
- Public privacy policy and data deletion callback (served statically by Caddy,
  alongside terms).
- Respect the Messenger 24-hour messaging window.
