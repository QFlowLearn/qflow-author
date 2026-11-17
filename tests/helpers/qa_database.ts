import { requirePostgresDatabaseUrl } from '../../tools/test_database_url.ts';

/** Require the explicitly configured dedicated local or CI QA database; never choose another one. */
export function requireQaDatabaseUrl(value: string | undefined): string {
  const configured = requirePostgresDatabaseUrl(value);
  const url = new URL(configured);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !['/qflow_test', '/qflow_ci_test'].includes(url.pathname)
  ) {
    throw new Error('Browser QA requires a dedicated local QFlow test database.');
  }
  return configured;
}
