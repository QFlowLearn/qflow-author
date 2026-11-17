import { and, eq, gte, sql } from 'drizzle-orm';
import type { db } from '../db.ts';
import { assessmentPlacements } from '../db/schema.ts';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Reserve a contiguous range while the caller holds the assessment lock.
 * Returns null without changing order when the anchor is no longer in this part.
 */
export async function reserveAssessmentPositions(
  tx: Transaction,
  partId: string,
  count: number,
  beforePlacementId?: string,
): Promise<number | null> {
  if (beforePlacementId === undefined) {
    const [last] = await tx.select({
      position: sql<number>`coalesce(max(${assessmentPlacements.position}), 0)`,
    })
      .from(assessmentPlacements).where(eq(assessmentPlacements.assessmentPartId, partId));
    return Number(last.position) + 1;
  }
  const [anchor] = await tx.select({ position: assessmentPlacements.position })
    .from(assessmentPlacements).where(and(
      eq(assessmentPlacements.id, beforePlacementId),
      eq(assessmentPlacements.assessmentPartId, partId),
    ));
  if (!anchor) return null;
  await tx.update(assessmentPlacements)
    .set({ position: sql`${assessmentPlacements.position} + ${count}` })
    .where(
      and(
        eq(assessmentPlacements.assessmentPartId, partId),
        gte(assessmentPlacements.position, anchor.position),
      ),
    );
  return anchor.position;
}
