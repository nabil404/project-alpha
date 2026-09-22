import { z } from 'zod';

/** Validated once at startup: a missing secret must stop the process, not a request. */
/** An unset variable in a .env file arrives as '', not as undefined. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  DATABASE_IDLE_TX_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  REDIS_URL: z.string().url(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),

  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: optional(z.string()),
  GOOGLE_CLIENT_SECRET: optional(z.string()),
  FACEBOOK_CLIENT_ID: optional(z.string()),
  FACEBOOK_CLIENT_SECRET: optional(z.string()),

  META_APP_SECRET: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/, 'e.g. v21.0'),

  /** 32 bytes, base64. Encrypts Page access tokens at rest (AES-256-GCM). */
  TOKEN_ENCRYPTION_KEY: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
    message: 'TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded',
  }),

  SMTP_URL: z.string().url(),
  MAIL_FROM: z.string().min(1),

  LLM_PROVIDER: z.string().default('anthropic'),
  LLM_MODEL_ROUTING: z.string().default('claude-haiku-4-5-20251001'),
  LLM_MODEL_EXTRACTION: z.string().default('claude-sonnet-5'),
  LLM_API_KEY: optional(z.string()),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: optional(z.string().url()),
});

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
