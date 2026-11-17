/** Require an explicitly configured, syntactically valid PostgreSQL database URL. */
export function requirePostgresDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('DATABASE_URL is required for integration tests.');

  let url: URL;
  try {
    url = new URL(value);
  } catch (_cause: unknown) {
    throw new Error('Integration tests require a valid PostgreSQL DATABASE_URL.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('Integration tests require a PostgreSQL DATABASE_URL.');
  }
  return value;
}
