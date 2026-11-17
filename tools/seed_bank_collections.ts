import * as _path from 'node:path';
import * as _url from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { db, shutdownDb } from '../lib/db.ts';
import { questions } from '../lib/db/question_schema.ts';
import { DEMO_PRESIDENT_SOURCES } from '../lib/demo_presidents_catalog.ts';
import { applyBankCollectionCommand } from '../lib/services/bank_collections.ts';
import { getMembershipRole } from '../lib/services/memberships.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { isCanonicalUuid } from '../lib/uuid.ts';
import { uuidV5 } from '../lib/uuid_v5.ts';

/** Explicit demo filing fixture. Requires the existing presidents pool; never seeds on application reads. */
export async function seedDemoBankCollections(ctx: RequestContext): Promise<readonly string[]> {
  const ids = await Promise.all(
    DEMO_PRESIDENT_SOURCES.slice(0, 8).map((source) =>
      uuidV5(ctx.tenantId, `demo:presidents:question:${source.stableKey}`)
    ),
  );
  const existing = await db.select({ id: questions.id }).from(questions).where(
    and(eq(questions.tenantId, ctx.tenantId), inArray(questions.id, ids)),
  );
  if (existing.length !== ids.length) {
    throw new Error('Create the presidents demo before explicitly filing its collection fixtures.');
  }
  const fixtures = [
    { key: 'foundations', name: 'Presidents / Foundations', questionIds: ids },
    { key: 'shared', name: 'Presidents / Shared questions', questionIds: ids.slice(0, 2) },
  ];
  const collections: string[] = [];
  for (const [position, fixture] of fixtures.entries()) {
    const collectionId = await uuidV5(ctx.tenantId, `demo:collection:${fixture.key}`);
    for (
      const [suffix, command] of [
        ['create', {
          _tag: 'Create',
          collectionId,
          name: fixture.name,
          description: 'Explicit demo collection using existing questions.',
          position,
        }],
        ['file', { _tag: 'AddItems', collectionId, questionIds: fixture.questionIds }],
      ] as const
    ) {
      const operationId = await uuidV5(ctx.tenantId, `demo:collection:${fixture.key}:${suffix}`);
      const result = await applyBankCollectionCommand(ctx, operationId, command);
      if (!result.ok) throw new Error(`Demo collection command rejected: ${result.code}`);
    }
    collections.push(collectionId);
  }
  return collections;
}

if ((process.argv[1] && _path.resolve(process.argv[1]) === _url.fileURLToPath(import.meta.url))) {
  const [tenantId, userId] = process.argv.slice(2);
  if (
    process.argv.slice(2).length !== 2 || !isCanonicalUuid(tenantId) || !isCanonicalUuid(userId)
  ) {
    throw new Error('Usage: seed_bank_collections.ts <tenant UUID> <member UUID>');
  }
  try {
    const role = await getMembershipRole(userId, tenantId);
    if (!role) throw new Error('The supplied actor is not a current workspace member.');
    await seedDemoBankCollections({ tenantId, userId, role });
    console.log('Demo collections are ready.');
  } finally {
    await shutdownDb();
  }
}
