// Specs reach Postgres and Redis only through these, never through the app's
// DATABASE_URL, DATABASE_ADMIN_URL or REDIS_URL. jest.global-setup.mjs loads
// the TEST_* keys from environments/.env, then creates and migrates the test
// database. When a variable is unset, the specs that need it are skipped.
//
// The database URL is the owner, a superuser, so RLS does not apply to it.
// openRuntimeDb() in catalog-test-db.ts switches to app_runtime to test policies.
export const testDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL;
export const testRedisUrl = process.env.TEST_REDIS_URL;

export const describeDb = testDatabaseUrl ? describe : describe.skip;
export const describeRedis = testRedisUrl ? describe : describe.skip;
