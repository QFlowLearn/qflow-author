import { and, eq, inArray, or } from 'drizzle-orm';

import type { DbReadConnection } from '../db.ts';
import { questionRevisions, questions } from '../db/schema.ts';
import type {
  PlacementQuestionRevisionRow,
  PlacementRevisionSelection,
} from '../placement_question_views.ts';

const placementQuestionRevisionColumns = {
  itemId: questions.id,
  latestRevisionId: questions.latestRevisionId,
  revisionId: questionRevisions.id,
  revision: questionRevisions.revision,
  body: questionRevisions.body,
  reviewSuggestions: questionRevisions.reviewSuggestions,
};

/** Loads only the tenant-owned latest and pinned revision rows selected by placements. */
export async function loadPlacementQuestionRevisionRows(
  connection: DbReadConnection,
  tenantId: string,
  selection: PlacementRevisionSelection,
): Promise<readonly PlacementQuestionRevisionRow[]> {
  const [latestRows, pinnedRows] = await Promise.all([
    loadLatestRows(connection, tenantId, selection.latestItemIds),
    loadPinnedRows(connection, tenantId, selection.pinnedRevisions),
  ]);
  const rowsByRevisionId = new Map<string, PlacementQuestionRevisionRow>();
  for (const row of [...latestRows, ...pinnedRows]) {
    rowsByRevisionId.set(row.revisionId, row);
  }
  return Array.from(rowsByRevisionId.values());
}

async function loadLatestRows(
  connection: DbReadConnection,
  tenantId: string,
  itemIds: readonly string[],
): Promise<readonly PlacementQuestionRevisionRow[]> {
  if (itemIds.length === 0) return [];
  return await connection.select(placementQuestionRevisionColumns)
    .from(questions)
    .innerJoin(
      questionRevisions,
      and(
        eq(questionRevisions.id, questions.latestRevisionId),
        eq(questionRevisions.questionId, questions.id),
        eq(questionRevisions.tenantId, tenantId),
      ),
    )
    .where(and(
      eq(questions.tenantId, tenantId),
      inArray(questions.id, itemIds),
    ));
}

async function loadPinnedRows(
  connection: DbReadConnection,
  tenantId: string,
  selectors: PlacementRevisionSelection['pinnedRevisions'],
): Promise<readonly PlacementQuestionRevisionRow[]> {
  if (selectors.length === 0) return [];
  return await connection.select(placementQuestionRevisionColumns)
    .from(questions)
    .innerJoin(
      questionRevisions,
      and(
        eq(questionRevisions.questionId, questions.id),
        eq(questionRevisions.tenantId, tenantId),
      ),
    )
    .where(and(
      eq(questions.tenantId, tenantId),
      or(...selectors.map((selector) =>
        and(
          eq(questions.id, selector.itemId),
          eq(questionRevisions.revision, selector.revision),
        )
      )),
    ));
}
