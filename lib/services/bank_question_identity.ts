import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbReadConnection } from '../db.ts';
import { assessmentParts, assessmentPlacements, questionRevisions } from '../db/schema.ts';
import {
  QUESTION_SELECTION_MAX_BYTES,
  questionSelectionIdentity,
} from '../question_selection_identity.ts';
import type { ProposalExclusion } from '../bank_question_proposal.ts';
import { loadPlacementQuestionRevisionRows } from './placement_question_revision_rows.ts';

/** Bounded revision reads; retain null for content whose equality cannot be established. */
export async function loadQuestionSelectionIdentities(
  tx: DbReadConnection,
  tenantId: string,
  revisionIds: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  const ids = [...new Set(revisionIds)], result = new Map<string, string | null>();
  for (let offset = 0; offset < ids.length; offset += 20) {
    const rows = await tx.select({
      id: questionRevisions.id,
      xml: sql<
        string | null
      >`CASE WHEN octet_length(${questionRevisions.qtiXml}) <= ${QUESTION_SELECTION_MAX_BYTES} THEN ${questionRevisions.qtiXml} ELSE NULL END`,
    }).from(
      questionRevisions,
    )
      .where(
        and(
          eq(questionRevisions.tenantId, tenantId),
          inArray(questionRevisions.id, ids.slice(offset, offset + 20)),
        ),
      );
    // CPU/crypto work is bounded to one database batch.
    for (
      const [id, identity] of await Promise.all(
        rows.map(async (row) =>
          [row.id, row.xml === null ? null : await questionSelectionIdentity(row.xml)] as const
        ),
      )
    ) result.set(id, identity);
  }
  return result;
}

/** Existing placements use their pinned revision; unpinned placements resolve the latest revision. */
export async function assessmentSelectionRevisions(
  tx: DbReadConnection,
  tenantId: string,
  assessmentId: string,
) {
  const placementRows = await tx.select({
    itemId: assessmentPlacements.questionId,
    revision: assessmentPlacements.pinnedRevision,
  })
    .from(assessmentPlacements).innerJoin(
      assessmentParts,
      eq(assessmentParts.id, assessmentPlacements.assessmentPartId),
    )
    .where(eq(assessmentParts.assessmentId, assessmentId));
  const placements = placementRows.flatMap((placement) =>
    placement.itemId === null ? [] : [{ ...placement, itemId: placement.itemId }]
  );
  const rows = await loadPlacementQuestionRevisionRows(tx, tenantId, {
    latestItemIds: placements.filter((p) => p.revision === null).map((p) => p.itemId),
    pinnedRevisions: placements.flatMap((p) =>
      p.revision === null ? [] : [{ itemId: p.itemId, revision: p.revision }]
    ),
  });
  if (
    placements.some((p) =>
      !rows.some((row) =>
        row.itemId === p.itemId &&
        (p.revision === null
          ? row.revisionId === row.latestRevisionId
          : row.revision === p.revision)
      )
    )
  ) return null;
  return rows;
}

/** A missing selected revision or unresolved external content prevents a false distinctness claim. */
export async function proposalExclusions(
  tx: DbReadConnection,
  tenantId: string,
  assessmentId: string,
  selected: readonly ProposalExclusion[],
): Promise<
  { readonly itemIds: ReadonlySet<string>; readonly identities: ReadonlySet<string> } | null
> {
  const placed = await assessmentSelectionRevisions(tx, tenantId, assessmentId);
  if (!placed) return null;
  const pending = await loadPlacementQuestionRevisionRows(tx, tenantId, {
    latestItemIds: [],
    pinnedRevisions: selected,
  });
  if (pending.length !== selected.length) return null;
  const rows = [...placed, ...pending];
  const identities = await loadQuestionSelectionIdentities(
    tx,
    tenantId,
    rows.map((r) => r.revisionId),
  );
  const values = new Set<string>();
  for (const row of rows) {
    const identity = identities.get(row.revisionId);
    if (!identity) return null;
    values.add(identity);
  }
  return { itemIds: new Set(rows.map((r) => r.itemId)), identities: values };
}
