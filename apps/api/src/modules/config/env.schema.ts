import { z } from 'zod';

/** Validated once at startup: a missing secret must stop the process, not a request. */
/** An unset variable in a .env file arrives as '', not as undefined. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const envObject = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  DATABASE_IDLE_TX_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  REDIS_URL: z.string().url(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),

  BETTER_AUTH_SECRET: z.string().min(32, 'at least 32 characters: openssl rand -base64 32'),
  GOOGLE_CLIENT_ID: optional(z.string()),
  GOOGLE_CLIENT_SECRET: optional(z.string()),
  FACEBOOK_CLIENT_ID: optional(z.string()),
  FACEBOOK_CLIENT_SECRET: optional(z.string()),

  /** Optional: without it the API boots and connecting a Page answers MESSENGER_NOT_CONFIGURED. */
  META_APP_ID: optional(z.string()),
  META_APP_SECRET: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/, 'e.g. v21.0'),

  /** 32 bytes, base64. Encrypts Page access tokens at rest (AES-256-GCM). */
  TOKEN_ENCRYPTION_KEY: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
    message: 'TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded',
  }),

  SMTP_URL: z.string().url(),
  MAIL_FROM: z.string().min(1),

  /** S3 API endpoint of the object store (Cloudflare R2 today). */
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_REGION: z.string().min(1).default('auto'),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  /** Where the bucket is served publicly; object keys are appended after a slash. */
  STORAGE_PUBLIC_BASE_URL: z.string().url(),

  /** The assistant's provider. Only OpenAI is wired; adding one is an enum member and a factory line in LlmModule. */
  LLM_PROVIDER: z.enum(['openai']).default('openai'),
  /** Intent and phrasing, every turn: the small, fast model. */
  LLM_MODEL_ROUTING: z.string().min(1).default('gpt-6-luna'),
  /** Order extraction, mid-flow turns only: the larger model. */
  LLM_MODEL_EXTRACTION: z.string().min(1).default('gpt-6.1-sol'),
  /** Per call; the AI SDK's one retry happens inside it. */
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** Optional: without it the worker stores messages but queues no assistant turns. */
  LLM_API_KEY: optional(z.string()),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: optional(z.string().url()),
});

/**
 * The values .env.example ships, or once shipped, in place of a real secret.
 * They pass every shape check - the example auth secret is long enough - so a
 * copied file would otherwise boot production signing sessions with a key
 * anyone can read in this repository. Development may keep them.
 */
const PLACEHOLDER_AUTH_SECRET = /replace-me/i;
const PLACEHOLDER_DB_PASSWORD = 'APP_RUNTIME_PASSWORD';

function refusePlaceholderSecrets(
  env: { NODE_ENV: string; BETTER_AUTH_SECRET: string; DATABASE_URL: string },
  ctx: z.RefinementCtx,
): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }
  if (PLACEHOLDER_AUTH_SECRET.test(env.BETTER_AUTH_SECRET)) {
    ctx.addIssue({
      code: 'custom',
      path: ['BETTER_AUTH_SECRET'],
      message: 'is the .env.example placeholder: openssl rand -base64 32',
    });
  }
  if (databasePassword(env.DATABASE_URL) === PLACEHOLDER_DB_PASSWORD) {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: 'uses the .env.example placeholder password: set APP_RUNTIME_PASSWORD',
    });
  }
}

function databasePassword(url: string): string {
  try {
    return decodeURIComponent(new URL(url).password);
  } catch {
    return '';
  }
}

export const envSchema = envObject.superRefine(refusePlaceholderSecrets);

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
