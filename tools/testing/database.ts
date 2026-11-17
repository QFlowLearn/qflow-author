import postgres from 'postgres';
import { requireQaDatabaseUrl } from '../../tests/helpers/qa_database.ts';
/** Change only the database pathname after an explicit QA selection, then attest it through SQL. */
export async function qaDatabase(selection: string): Promise<string> {
  if (selection !== 'qflow_test' && selection !== 'qflow_ci_test') {
    throw Error('Explicitly select the local or CI QA database.');
  }
  const configured = process.env.DATABASE_URL;
  if (!configured) throw Error('Load the configured PostgreSQL connection before verification.');
  const url = new URL(configured);
  url.pathname = '/' + selection;
  const databaseUrl = requireQaDatabaseUrl(url.toString());
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 3, idle_timeout: 1 });
  try {
    const result = await client<{ name: string }[]>`select current_database() as name`;
    if (result[0]?.name !== selection) throw Error('QA database identity differs.');
  } finally {
    await client.end({ timeout: 1 });
  }
  console.log('Guarded QA database identity verified.');
  return databaseUrl;
}
