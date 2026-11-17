import { canonicalJsonStringify, projectJsonPersistenceObject } from './canonical_json.ts';
import { sha256Hex } from './sha256.ts';
import type { AssessmentContentPlacement } from './assessment_standalone_content.ts';

/** Ordered arrangement fields that participate in optimistic concurrency. */
export type AssessmentArrangementSnapshot = readonly {
  readonly id: string;
  readonly title: string;
  readonly options?: Record<string, unknown>;
  readonly placements: readonly (AssessmentContentPlacement | {
    readonly id: string;
    readonly itemId: string;
    readonly snapshotRev?: number | null;
    readonly blueprintTargetId?: string | null;
    readonly fixed?: boolean;
  })[];
}[];

/** Hash the exact ordered membership/settings snapshot, independent of JSON key order. */
export async function assessmentArrangementVersion(
  assessmentId: string,
  parts: AssessmentArrangementSnapshot,
): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(canonicalJsonStringify({
    assessmentId,
    parts: parts.map((part) => ({
      id: part.id,
      title: part.title,
      options: projectJsonPersistenceObject(part.options ?? {}),
      placements: part.placements.map((placement) =>
        'content' in placement
          ? {
            id: placement.id,
            content: placement.content,
            fixed: true,
          }
          : ({
            id: placement.id,
            itemId: placement.itemId,
            snapshotRev: placement.snapshotRev ?? null,
            blueprintTargetId: placement.blueprintTargetId ?? null,
            fixed: placement.fixed === true,
          })
      ),
    })),
  })));
}
