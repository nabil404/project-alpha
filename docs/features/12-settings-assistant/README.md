# 12 · Settings – Order assistant

How the assistant talks to the shop's customers: its tone, the language it
falls back to, and short facts from the seller.

**Status (Oct 2026):** the design's "How it talks" card is built, API and
page. The assistant uses the tone and the default language when it phrases
a reply. The notes are stored but not yet read by the assistant. The
design's "Order assistant" switches are not built yet.

## Routes (session + TenantGuard)

| Route                              | Request                                           | Response                    | Errors                  |
| ---------------------------------- | ------------------------------------------------- | --------------------------- | ----------------------- |
| `GET /api/v1/settings/assistant`   | none                                              | `AssistantSettingsView`     | none                    |
| `PATCH /api/v1/settings/assistant` | any of `{ tone, defaultLanguage, notes }`, strict | 200 `AssistantSettingsView` | 400 `VALIDATION_FAILED` |

`AssistantSettingsView` is `AssistantSettings` plus `supportedLanguages`, the
codes `defaultLanguage` may name besides `match`. Both are in
[`packages/shared/src/schemas/assistant-settings.ts`](../../../packages/shared/src/schemas/assistant-settings.ts)
with `ASSISTANT_SETTINGS_DEFAULTS`:

| Field             | Values                                                                  | Default    |
| ----------------- | ----------------------------------------------------------------------- | ---------- |
| `tone`            | `friendly` (Friendly and polite), `direct` (Short and direct), `formal` | `friendly` |
| `defaultLanguage` | `match` (Match the customer), or a code in `ASSISTANT_LANGUAGES`        | `match`    |
| `notes`           | Text, trimmed, at most 1000 characters (`ASSISTANT_NOTES_MAX`)          | `''`       |

**Supported languages come from the env.** `ASSISTANT_LANGUAGES` holds ISO
639-1 codes, comma-separated, and is `en,bn` when unset or blank
([LLM setup](../../setup/llm-setup.md)). The shared schema checks only the
code's shape; the service refuses a code the env does not list with
`VALIDATION_FAILED`, an `INVALID_VALUE` error on `defaultLanguage` whose
`values` param lists `match` and the supported codes. The dashboard names
each code with `Intl.DisplayNames` in the reader's language. The design shows
eight (English, Arabic, Bangla, Hindi, Indonesian, Spanish, Swahili, Urdu):
set `ASSISTANT_LANGUAGES=en,ar,bn,hi,id,es,sw,ur` for that list.

## Rules

- **One set per shop.** The merchant comes from the session's active
  organization, never from the request.
- **Defaults** apply until the first save. Reading never writes a row.
- **`PATCH` writes only the fields it was sent.** The first write fills the
  rest from the defaults. An empty body changes nothing.
- **Tone** goes into every `phraseReply` call as a `Tone:` line
  ([ai.md](../../architecture/ai.md#phrasereply)). The fixed sentences
  (hand-off, summary, entry replies) do not change with it.
- **Default language** replaces the fallback language of `phraseReply`, the
  one used when the customer's own language is unclear. `match` keeps
  today's rule: Bangla for a shop in Bangladesh, English elsewhere. A saved
  code that `ASSISTANT_LANGUAGES` no longer lists reads, and replies, as
  `match`; the row keeps it, so adding the code back restores it. The
  assistant still replies in the customer's language when it can tell. The
  fixed sentences still follow the shop's country, because they exist only
  in Bangla and English.
- **Notes** are the seller's facts, never prices or stock, which come from
  the catalog. The assistant does not read them yet.

## Dashboard

`/settings/assistant` has one card, "How it talks": Tone and Default
language side by side from `sm` up, then the notes textarea with its hint
and a 1,000-character limit. Default language lists "Match the customer"
first, then `supportedLanguages` from the response, named with
`Intl.DisplayNames` in the dashboard's language and sorted by name. The
card saves the three fields together through the shared `SaveBar`, quiet
until something changed. A save resets the form to the saved (trimmed)
values and shows a toast. A field error from the API, such as a language
the env stopped listing between load and save, shows under its field; any
other failure shows an `ErrorBanner` in the card.

## Data model

`assistant_settings`: primary key `merchant_id`, plus `tone`,
`default_language` and `notes`, each with a check constraint;
`default_language` is checked for shape only (`match` or two lower-case
letters). The columns have no defaults, because the repository writes
`ASSISTANT_SETTINGS_DEFAULTS` itself. The schema keeps a literal copy of the
tones, and `reply-phrasing.spec.ts` keeps it equal to `@app/shared`'s.
Migrations `0046_settings_assistant`, `0047_assistant_settings_force_rls` and
`0048_assistant_language_from_env` create it.
See [database.md](../../architecture/database.md).

## Code and tests

- `apps/api/src/modules/settings/`: `AssistantSettingsService`,
  `AssistantSettingsRepository` and `assistant-settings.controller.ts`.
- `apps/api/src/modules/conversations/assistant/`: `AssistantTurnService`
  reads the settings through `AssistantSettingsService.read` in the turn's
  first transaction, and `phraseVoice`
  (`reply-phrasing.ts`) turns them into the `PhraseRequest`'s tone and
  language.
- Web: `features/settings/components/AssistantVoiceCard.tsx`,
  `features/settings/assistant-queries.ts` and
  `routes/_app/settings/assistant.tsx`, under `apps/web/src/`.

| Spec                                                                                                                                                   | Covers                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`settings/__tests__/assistant-settings.e2e.spec.ts`](../../../apps/api/src/modules/settings/__tests__/assistant-settings.e2e.spec.ts)                 | Defaults, `supportedLanguages`, partial updates, trimmed notes, a language the env does not list, another seller's settings, the errors over HTTP |
| [`assistant/__tests__/reply-phrasing.spec.ts`](../../../apps/api/src/modules/conversations/assistant/__tests__/reply-phrasing.spec.ts)                 | `phraseVoice`, the prompt's tone and language lines, the schema's literal tones                                                                   |
| [`assistant/__tests__/assistant-turn.service.spec.ts`](../../../apps/api/src/modules/conversations/assistant/__tests__/assistant-turn.service.spec.ts) | A saved tone and language reach `phraseReply`, for that shop only; a code since removed falls back to the country's                               |

## Follow-ups

- **Answer customers from the notes.** A question (`ask_question`) hands off
  to the seller today. Answering from the notes needs a new reply kind, and
  `checkReply` must accept the numbers the notes hold.
- **Fixed sentences in the default language**, which needs every
  `FallbackKey` written in each language.
- **The "Order assistant" switches** in the same design (draft orders, ask
  to confirm, hand off when unsure, confirm without me).
