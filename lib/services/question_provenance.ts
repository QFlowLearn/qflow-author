import { inArray } from 'drizzle-orm';

import { db } from '../db.ts';
import { users } from '../db/schema.ts';
import { createQuestionActorSnapshot, type QuestionActorSnapshot } from '../question_provenance.ts';

type QuestionProvenanceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Load the immutable actor facts captured by a question-history event. */
export async function loadQuestionActorSnapshotInTransaction(
  tx: QuestionProvenanceTransaction,
  userId: string,
): Promise<QuestionActorSnapshot> {
  const actors = await loadActors(tx, [userId]);
  return requireActor(actors, userId);
}

async function loadActors(
  tx: QuestionProvenanceTransaction,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, QuestionActorSnapshot>> {
  const ids = [...new Set(userIds)];
  const rows = await tx.select({
    id: users.id,
    displayName: users.displayName,
    email: users.email,
  }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((row) => [
    row.id,
    createQuestionActorSnapshot({
      id: row.id,
      displayName: row.displayName,
      email: row.email,
    }),
  ]));
}

function requireActor(
  actors: ReadonlyMap<string, QuestionActorSnapshot>,
  userId: string,
): QuestionActorSnapshot {
  const actor = actors.get(userId);
  if (!actor) throw new Error('Question history actor does not exist.');
  return actor;
}
