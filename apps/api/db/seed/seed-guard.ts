const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Why the seed must not run here, or null when it may: development, against a local database. */
export function refuseUnlessLocal(nodeEnv: string, databaseUrl: string): string | null {
  if (nodeEnv !== 'development') {
    return `The seed runs only with NODE_ENV=development (it is ${nodeEnv}).`;
  }
  const host = new URL(databaseUrl).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    return `The seed runs only against a local database (DATABASE_URL points at ${host}).`;
  }
  return null;
}
