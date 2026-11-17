import { db } from '../lib/db.ts';
import type { QuestionProvenanceCommand } from '../lib/question_provenance.ts';
import { prepareQuestionRevision } from '../lib/question_revision_preparation.ts';
import type { QuestionRevisionWriteInput } from '../lib/services/question_revision_persistence.ts';
import { saveQuestionRevisionInTransaction } from '../lib/services/questions.ts';
import type { RequestContext } from '../lib/tenants.ts';

/** Input for persisting a standalone question revision in integration tests. */
export type TestQuestionRevisionInput = QuestionRevisionWriteInput & {
  readonly provenance: QuestionProvenanceCommand;
};

/** Persist a standalone revision for integration-test fixture setup. */
export async function saveQuestionRevisionFixture(
  ctx: RequestContext,
  input: TestQuestionRevisionInput,
) {
  const prepared = await prepareQuestionRevision(input);
  return await db.transaction((tx) => saveQuestionRevisionInTransaction(tx, ctx, prepared));
}
