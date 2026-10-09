# LLM setup

How to get the API key behind the AI assistant, and fill:

```dotenv
# ---- LLM ----
LLM_PROVIDER=openai
LLM_MODEL_ROUTING=gpt-6-luna
LLM_MODEL_EXTRACTION=gpt-6.1-sol
LLM_TIMEOUT_MS=15000
LLM_API_KEY=
```

All five are optional and have defaults in
[`env.schema.ts`](../../apps/api/src/modules/config/env.schema.ts) (the
defaults are also in [`.env.example`](../../apps/api/.env.example)). The worker
reads them for every assistant turn
([phase 11.1](../features/11-ai-implementation/phase-1-foundation/README.md)).
Without `LLM_API_KEY` the API and worker still boot and store messages, but no
assistant turns are queued, so customers get no AI reply.

`LLM_PROVIDER` accepts only `openai`. An environment still set to
`LLM_PROVIDER=anthropic` (the old default) fails validation at boot: change it
in every local `.env` and in Parameter Store before deploying.

## What each variable is for

| Variable               | Used for                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LLM_PROVIDER`         | The provider behind the AI SDK. Only `openai` is supported.                                                                                                                                       |
| `LLM_MODEL_ROUTING`    | The efficient model: classifying intent and phrasing replies, every turn                                                                                                                          |
| `LLM_MODEL_EXTRACTION` | The mid-tier model: extracting order details when the customer is ordering or editing an order; product photos in [phase 11.6](../features/11-ai-implementation/phase-6-product-photos/README.md) |
| `LLM_TIMEOUT_MS`       | A timeout for each call, 15000 by default. A call that exceeds it counts as a failure and the conversation is handed off                                                                          |
| `LLM_API_KEY`          | The provider's API key. A secret                                                                                                                                                                  |

Model IDs change as new models ship; check
[OpenAI's models page](https://developers.openai.com/api/docs/models) before
changing a default, and keep `.env.example` and `env.schema.ts` in step.

## Steps

### 1. Create a project per environment

1. Sign in to platform.openai.com with a team account, not a personal one.
2. Add billing (prepaid credit is enough for development and the pilot).
3. Create one **project** per environment, for example `social-glider-dev`
   and `social-glider-prod`. Each project has its own keys, usage and limits,
   so development traffic never spends production's budget and a leaked
   development key cannot run up production's bill.

### 2. Set a budget

On each project, set a monthly **budget** and an email alert below it. Every
call is also recorded per shop in the `llm_call` table, so usage can be traced
to a seller.

### 3. Create the API key

In the project, **API keys → Create new secret key**, name it after the
environment (`dev-api`), and copy it once into `LLM_API_KEY`. The dashboard
does not show it again.

### 4. Fill the env file

In `apps/api/.env`:

```dotenv
LLM_PROVIDER=openai
LLM_API_KEY=<the key>
```

Leave the model variables and `LLM_TIMEOUT_MS` unset to use the defaults. A `$`
in any value must be written `$$`: compose interpolates this file. Restart the
API and the worker after any change. On a server, the key goes into Parameter
Store with the other secrets ([deployment](../architecture/deployment.md)).

### 5. Verify

1. Start the stack: `pnpm dev:up`, `pnpm dev` and
   `pnpm --filter api dev:worker`, with the Messenger webhook working
   ([Meta setup](meta-setup.md#11-verify)).
2. Send a text message to the test Page. The `assistant-turns` queue in Bull
   Board (<http://localhost:5173/api/queues>) shows the turn, the customer gets
   a reply, and `llm_call` rows are written.
3. Set a wrong key and send another message: the conversation goes to
   `handed_off` and the customer gets the fixed hand-off reply.

## Troubleshooting

| Symptom                                               | Cause and fix                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| The API will not boot, with a `LLM_PROVIDER` error    | The env still says `anthropic`. Set `LLM_PROVIDER=openai`.                                                             |
| Messages are stored but no turn appears in Bull Board | `LLM_API_KEY` is unset, the worker is not running, the bot is paused on that conversation, or the Page's bot is off.   |
| Every conversation goes straight to `handed_off`      | The key is wrong or revoked, the project is out of credit or over its budget, or a model ID no longer exists.          |
| Replies are slow, or many turns time out              | The provider is degraded or the extraction model is overloaded; the turns hand off as designed. Check its status page. |

## Secrets

Never commit the key, paste it into an issue, or log it: the pino redact list
covers `*.apiKey`. If it leaks, revoke it in the dashboard, create a new one,
update `LLM_API_KEY` everywhere it is set, and restart the API and worker.
