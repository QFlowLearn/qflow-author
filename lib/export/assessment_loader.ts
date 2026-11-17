import { AssessmentExportError } from './assessment_export_error.ts';
import { assessmentQuestionPlacements } from '../assessment_content.ts';
import { loadOrganizationTransfers } from '../services/question_organization_transfer.ts';
import type { OrganizationByItem } from '../organization_transfer.ts';
import { and, eq, inArray, or } from 'drizzle-orm';
import { inspectQtiBinaryChoice } from '@longsightgroup/qti3-core';

import type { DbReadConnection } from '../db.ts';
import { questionRevisions, questions } from '../db/schema.ts';
import { normalizePlacementRevisionSelectors } from '../placement_question_views.ts';
import { toPackageIdentifier } from '../qti_identifiers.ts';
import { extractCurriculumStandards, type StandardsByItem } from '../standards.ts';
import type { RequestContext } from '../tenants.ts';
import type { AssessmentExportDocument, AssessmentExportSelectionDocument } from './assessment.ts';
import { parseQuestionTags, type TagsByItem } from '../question_tags.ts';

/** Revision-resolved assessment document and item resources ready for package construction. */
export type AssessmentItemExportMapResult = {
  readonly document: AssessmentExportDocument;
  readonly itemsXml: Record<string, string>;
  readonly standardsByItem: StandardsByItem;
  readonly tagsByItem: TagsByItem;
  readonly organizationByItem: OrganizationByItem;
  readonly omittedOrganizationItemIds: readonly string[];
};

type AssessmentItemRevisionRow = {
  readonly itemId: string;
  readonly latestRevisionId: string | null;
  readonly revisionId: string;
  readonly revision: number;
  readonly body: Record<string, unknown>;
  readonly metadata: Record<string, unknown> | null;
  readonly qtiXml: string;
};

const assessmentItemRevisionColumns = {
  itemId: questions.id,
  latestRevisionId: questions.latestRevisionId,
  revisionId: questionRevisions.id,
  revision: questionRevisions.revision,
  body: questionRevisions.body,
  metadata: questionRevisions.metadata,
  qtiXml: questionRevisions.qtiXml,
};

/** Loads the canonical QTI 3 item revisions and standards metadata used by every export target. */
export async function loadAssessmentItemExports(
  connection: DbReadConnection,
  auth: RequestContext,
  selectionDocument: AssessmentExportSelectionDocument,
): Promise<AssessmentItemExportMapResult> {
  const references = selectionDocument.parts.flatMap((part) =>
    assessmentQuestionPlacements(part.placements).map((placement) => ({
      itemId: placement.itemId,
      revision: placement.snapshotRev,
    }))
  );
  const selection = normalizePlacementRevisionSelectors(references);
  const rows = await loadAssessmentItemRevisionRows(
    connection,
    auth.tenantId,
    selection,
  );
  const rowsByItemId = new Map<string, AssessmentItemRevisionRow[]>();
  for (const row of rows) {
    const itemRows = rowsByItemId.get(row.itemId) ?? [];
    itemRows.push(row);
    rowsByItemId.set(row.itemId, itemRows);
  }

  const { transfers, omittedRevisionIds } = await loadOrganizationTransfers(
    connection,
    auth.tenantId,
    rows.map((row) => ({ questionId: row.itemId, revisionId: row.revisionId })),
  );
  const omittedOrganizationItemIds = new Set<string>();
  const organizationByItem: Record<string, OrganizationByItem[string]> = {};
  const itemsXml: Record<string, string> = {};
  const standardsByItem: StandardsByItem = {};
  const tagsByItem: Record<string, readonly string[]> = {};
  const document: AssessmentExportDocument = {
    adaptivePlan: selectionDocument.adaptivePlan,
    assessment: selectionDocument.assessment,
    parts: selectionDocument.parts.map((part) => ({
      id: part.id,
      title: part.title,
      placements: part.placements.map((placement) => {
        if ('content' in placement) return placement;
        const row = findSelectedRevision(rowsByItemId, placement.itemId, placement.snapshotRev);
        if (!row) {
          throw new AssessmentExportError(
            `Missing revision for item ${placement.itemId}`,
          );
        }
        if (
          selectionDocument.adaptivePlan &&
          (placement.snapshotRev === null || !inspectQtiBinaryChoice(row.qtiXml).ok)
        ) {
          throw new AssessmentExportError(
            'Adaptive questions must be pinned single-choice revisions with 0/1 scoring.',
          );
        }
        const resourceId = assessmentItemResourceId(row.itemId, row.revision);
        if (omittedRevisionIds.includes(row.revisionId)) omittedOrganizationItemIds.add(resourceId);
        const existingXml = itemsXml[resourceId];
        if (existingXml !== undefined && existingXml !== row.qtiXml) {
          throw new AssessmentExportError(`Conflicting package resource ${resourceId}`);
        }
        itemsXml[resourceId] = row.qtiXml;
        const organization = transfers.get(row.revisionId);
        if (organization) organizationByItem[resourceId] = organization;
        const standards = extractCurriculumStandards(row.body, row.metadata);
        if (standards.length) standardsByItem[resourceId] = standards;
        const tags = parseQuestionTags(row.body.tags);
        if (tags.length) tagsByItem[resourceId] = tags;
        return { id: placement.id, itemId: resourceId, fixed: placement.fixed };
      }),
      options: part.options,
    })),
  };

  return {
    document,
    itemsXml,
    standardsByItem,
    tagsByItem,
    organizationByItem,
    omittedOrganizationItemIds: [...omittedOrganizationItemIds].sort(),
  };
}

async function loadAssessmentItemRevisionRows(
  connection: DbReadConnection,
  tenantId: string,
  selection: ReturnType<typeof normalizePlacementRevisionSelectors>,
): Promise<readonly AssessmentItemRevisionRow[]> {
  const [latestRows, pinnedRows] = await Promise.all([
    loadLatestAssessmentItemRevisionRows(connection, tenantId, selection.latestItemIds),
    loadPinnedAssessmentItemRevisionRows(connection, tenantId, selection.pinnedRevisions),
  ]);
  const rowsByRevisionId = new Map<string, AssessmentItemRevisionRow>();
  for (const row of [...latestRows, ...pinnedRows]) {
    rowsByRevisionId.set(row.revisionId, row);
  }
  return Array.from(rowsByRevisionId.values());
}

async function loadLatestAssessmentItemRevisionRows(
  connection: DbReadConnection,
  tenantId: string,
  itemIds: readonly string[],
): Promise<readonly AssessmentItemRevisionRow[]> {
  if (itemIds.length === 0) return [];
  return await connection.select(assessmentItemRevisionColumns)
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

async function loadPinnedAssessmentItemRevisionRows(
  connection: DbReadConnection,
  tenantId: string,
  selectors: ReturnType<typeof normalizePlacementRevisionSelectors>['pinnedRevisions'],
): Promise<readonly AssessmentItemRevisionRow[]> {
  if (selectors.length === 0) return [];
  return await connection.select(assessmentItemRevisionColumns)
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

function findSelectedRevision(
  rowsByItemId: ReadonlyMap<string, readonly AssessmentItemRevisionRow[]>,
  itemId: string,
  revision: number | null,
): AssessmentItemRevisionRow | undefined {
  const rows = rowsByItemId.get(itemId) ?? [];
  return revision === null
    ? rows.find((row) => row.revisionId === row.latestRevisionId)
    : rows.find((row) => row.revision === revision);
}

function assessmentItemResourceId(itemId: string, revision: number): string {
  return toPackageIdentifier(`item-${itemId}-r${revision}`, 'item');
}
