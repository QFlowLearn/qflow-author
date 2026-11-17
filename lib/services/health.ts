import { sql } from 'drizzle-orm';
import { db } from '../db.ts';

export async function checkDatabaseHealth(): Promise<void> {
  await db.execute(sql`select 1`);
}
