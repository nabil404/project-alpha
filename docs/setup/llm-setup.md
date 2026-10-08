# LLM setup

How to get the API key behind the AI assistant, and fill:

```dotenv
# ---- LLM ----
LLM_PROVIDER=anthropic
LLM_MODEL_ROUTING=
LLM_MODEL_EXTRACTION=
LLM_API_KEY=
```

All four are optional and have defaults in
[`env.schema.ts`](../../apps/api/src/modules/config/env.schema.ts) (the model
defaults are also in [`.env.example`](../../apps/api/.env.example)). Today only
the schema reads them: nothing calls the LLM until
[phase 11.1](../features/11-ai-implementation/phase-1-foundation/README.md)
lands. From then on, without `LLM_API_KEY` the API and worker still boot and
store messages, but no assistant turns are queued, so customers get no AI
reply.

## What each variable is for

| Variable               | Used for                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LLM_PROVIDER`         | The provider behind the AI SDK. Only `anthropic` is supported.                                                                                                                                  |
| `LLM_MODEL_ROUTING`    | The small, fast model: classifying intent and phrasing replies, every turn                                                                                                                      |
| `LLM_MODEL_EXTRACTION` | The larger model: extracting order details when the customer is ordering or editing an order; product photos in [phase 11.6](../features/11-ai-implementation/phase-6-product-photos/README.md) |
| `LLM_API_KEY`          | The provider's API key. A secret                                                                                                                                                                |

Phase 11.1 also adds `LLM_TIMEOUT_MS` (a timeout for each call, 15 seconds by
default). Model IDs change as new models ship; check the provider's current
model list before changing a default, and keep `.env.example` and
`env.schema.ts` in step.

## Steps

### 1. Create an account and a workspace per environment

1. Sign in to the Claude Console (Anthropic's developer console) with a team
   account, not a personal one.
2. Add billing (prepaid credits are enough for development and the pilot).
3. Create one **workspace** per environment, for example
   `social-glider-dev` and `social-glider-prod`. Each workspace has its own
   keys, usage and limits, so development traffic never spends production's
   budget and a leaked development key cannot run up production's bill.

### 2. Set spend limits

On each workspace, set a monthly **spend limit** and an email alert below it.
Every call is also recorded per shop in the `llm_call` table from phase 11.1 on,
so usage can be traced to a seller.

### 3. Create the API key

In the workspace, **API keys → Create key**, name it after the environment
(`dev-api`), and copy it once into `LLM_API_KEY`. The Console does not show it
again.

### 4. Fill the env file

In `apps/api/.env`:

```dotenv
LLM_PROVIDER=anthropic
LLM_API_KEY=<the key>
```

Leave `LLM_MODEL_ROUTING` and `LLM_MODEL_EXTRACTION` unset to use the
defaults. A `$` in any value must be written `$$`: compose interpolates this
file. Restart the API and the worker after any change. On a server, the key
goes into Parameter Store with the other secrets
([deployment](../architecture/deployment.md)).

### 5. Verify (from phase 11.1 on)

1. Start the stack: `pnpm dev:up`, `pnpm dev` and
   `pnpm --filter api dev:worker`, with the Messenger webhook working
   ([Meta setup](meta-setup.md#11-verify)).
2. Send a text message to the test Page. The `assistant-turns` queue in Bull
   Board (<http://localhost:5173/api/queues>) shows the turn, the customer gets
   a reply, and an `llm_call` row is written.
3. Set a wrong key and send another message: the conversation goes to
   `handed_off` and the customer gets the fixed hand-off reply.

## Troubleshooting

| Symptom                                               | Cause and fix                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Messages are stored but no turn appears in Bull Board | `LLM_API_KEY` is unset, the worker is not running, the bot is paused on that conversation, or the Page's bot is off.   |
| Every conversation goes straight to `handed_off`      | The key is wrong or revoked, the workspace is out of credit or over its spend limit, or a model ID no longer exists.   |
| Replies are slow, or many turns time out              | The provider is degraded or the extraction model is overloaded; the turns hand off as designed. Check its status page. |

## Secrets

Never commit the key, paste it into an issue, or log it: the pino redact list
covers `*.apiKey` from phase 11.1 on. If it leaks, revoke it in the Console,
create a new one, update `LLM_API_KEY` everywhere it is set, and restart the
API and worker.
