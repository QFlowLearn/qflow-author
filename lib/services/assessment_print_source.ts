import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db, type DbReadConnection, type QflowDatabase } from '../db.ts';
import { questionRevisions, questions } from '../db/schema.ts';
import type { RequestContext } from '../tenants.ts';
import { getAssessment } from './assessment_records.ts';
import { hasWorkspaceCapability } from './workspace_authorization.ts';
import { parseAssessmentPartOptions } from '../assessment_arrangement.ts';
import type { PrintSource } from '../print/print_snapshot.ts';
import type { PrintResult } from '../print/print_contract.ts';
import { parseXmlStrict } from '../import/xml_dom.ts';

/** Read ordered structure and immutable selected revisions together through the actual database seam. */
export async function readPrintSource(
  ctx: RequestContext,
  assessmentId: string,
  database: QflowDatabase = db,
): Promise<PrintResult<PrintSource>> {
  if (!await hasWorkspaceCapability(ctx, 'manage_content', database)) {
    return { ok: false, code: 'forbidden' };
  }
  return await database.transaction((tx) => readPrintSourceInTransaction(tx, ctx, assessmentId), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}

/** Caller owns the assessment/workspace lock when this is used for final freshness comparison. */
export async function readPrintSourceInTransaction(
  connection: DbReadConnection,
  ctx: RequestContext,
  assessmentId: string,
): Promise<PrintResult<PrintSource>> {
  const assessment = await getAssessment(ctx, assessmentId, connection);
  if (!assessment) return { ok: false, code: 'not_found' };
  const references = assessment.parts.flatMap((part) =>
    part.placements.flatMap((placement) => 'itemId' in placement ? [placement] : [])
  );
  const ids = [...new Set(references.map((reference) => reference.itemId))];
  const rows = ids.length && references.length <= 100
    ? await connection.select({
      questionId: questions.id,
      latest: questions.latestRevisionId,
      revisionId: questionRevisions.id,
      revision: questionRevisions.revision,
      xml: sql<
        string
      >`case when sum(octet_length(${questionRevisions.qtiXml})) over () <= 500000 then ${questionRevisions.qtiXml} else '' end`,
    })
      .from(questions).innerJoin(
        questionRevisions,
        and(
          eq(questionRevisions.questionId, questions.id),
          eq(questionRevisions.tenantId, ctx.tenantId),
        ),
      )
      .where(
        and(
          eq(questions.tenantId, ctx.tenantId),
          inArray(questions.id, ids),
          or(...references.map((reference) =>
            and(
              eq(questions.id, reference.itemId),
              reference.snapshotRev === null
                ? eq(questionRevisions.id, questions.latestRevisionId)
                : eq(questionRevisions.revision, reference.snapshotRev),
            )
          )),
        ),
      )
    : [];
  const parts: PrintSource['parts'][number][] = [];
  for (const part of assessment.parts) {
    const options = parseAssessmentPartOptions(part.options);
    if (!options.ok) return { ok: false, code: 'snapshot_corrupt' };
    const placements: PrintSource['parts'][number]['placements'][number][] = [];
    for (const placement of part.placements) {
      if ('content' in placement) {
        placements.push({ kind: 'content', id: placement.id, content: placement.content });
        continue;
      }
      const row = rows.find((row) =>
        row.questionId === placement.itemId &&
        (placement.snapshotRev === null
          ? row.revisionId === row.latest
          : row.revision === placement.snapshotRev)
      );
      if (!row) {
        placements.push({
          kind: 'unavailable',
          id: placement.id,
          questionId: placement.itemId,
          requestedRevision: placement.snapshotRev,
        });
        continue;
      }
      if (!row.xml) {
        placements.push({
          kind: 'unavailable',
          id: placement.id,
          questionId: placement.itemId,
          requestedRevision: placement.snapshotRev,
          reason: 'source_limit',
        });
        continue;
      }
      let staffTitle = '';
      try {
        staffTitle =
          parseXmlStrict(row.xml, 'staff item title').documentElement.getAttribute('title') ?? '';
      } catch {
        /* The complete preflight reports invalid XML for this placement; this title is optional staff metadata. */
      }
      placements.push({
        kind: 'question',
        id: placement.id,
        questionId: row.questionId,
        revisionId: row.revisionId,
        revision: row.revision,
        xml: row.xml,
        staffTitle,
      });
    }
    parts.push({ id: part.id, title: part.title, options: options.options, placements });
  }
  return {
    ok: true,
    value: {
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      assessmentMetadata: assessment.metadata,
      adaptive: assessment.adaptivePlan !== undefined,
      parts,
    },
  };
}
