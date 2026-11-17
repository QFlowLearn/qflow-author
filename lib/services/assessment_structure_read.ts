import { eq } from 'drizzle-orm';
import type { DbReadConnection } from '../db.ts';
import { assessmentParts, assessmentPlacements } from '../db/schema.ts';
import { projectJsonPersistenceObject } from '../canonical_json.ts';
import type { AssessmentPart } from './assessment_structure.ts';
import { parseAssessmentStandaloneContent } from '../assessment_standalone_content.ts';

/** Read actual persisted parts in canonical order after the caller establishes tenant ownership. */
export async function readAssessmentParts(
  database: DbReadConnection,
  id: string,
): Promise<AssessmentPart[]> {
  const partRows = await database.select({
    partId: assessmentParts.id,
    partTitle: assessmentParts.title,
    partOptions: assessmentParts.options,
    placementId: assessmentPlacements.id,
    questionId: assessmentPlacements.questionId,
    content: assessmentPlacements.content,
    pinnedRevision: assessmentPlacements.pinnedRevision,
    blueprintTargetId: assessmentPlacements.blueprintTargetId,
    fixed: assessmentPlacements.fixed,
  })
    .from(assessmentParts)
    .leftJoin(assessmentPlacements, eq(assessmentPlacements.assessmentPartId, assessmentParts.id))
    .where(eq(assessmentParts.assessmentId, id))
    .orderBy(assessmentParts.position, assessmentPlacements.position);
  const partsMap = new Map<string, AssessmentPart>();
  for (const partRow of partRows) {
    let part = partsMap.get(partRow.partId);
    if (!part) {
      part = {
        id: partRow.partId,
        title: partRow.partTitle,
        options: parseStoredOptions(partRow.partOptions),
        placements: [],
      };
      partsMap.set(partRow.partId, part);
    }
    if (partRow.placementId && partRow.questionId === null) {
      const parsed = parseAssessmentStandaloneContent(partRow.content);
      if (
        !parsed.ok || partRow.fixed !== true || partRow.pinnedRevision !== null ||
        partRow.blueprintTargetId !== null
      ) {
        throw new Error('Persisted assessment text placement is invalid.');
      }
      part.placements.push({ id: partRow.placementId, content: parsed.content, fixed: true });
    } else if (partRow.placementId && partRow.questionId) {
      if (partRow.content !== null) {
        throw new Error('Persisted question placement has competing content.');
      }
      if (typeof partRow.fixed !== 'boolean') {
        throw new Error('Persisted placement fixed-position setting must be a boolean.');
      }
      part.placements.push({
        id: partRow.placementId,
        itemId: partRow.questionId,
        snapshotRev: partRow.pinnedRevision ?? null,
        blueprintTargetId: partRow.blueprintTargetId ?? null,
        fixed: partRow.fixed,
      });
    }
  }
  return Array.from(partsMap.values());
}

function parseStoredOptions(value: Record<string, unknown>): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Persisted assessment part settings must be an object.');
  }
  return projectJsonPersistenceObject(value);
}
