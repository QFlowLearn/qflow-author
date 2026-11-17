/** Counts refer to assignments using one exact published assessment version. */
export type DeliveryAssessmentStatus = {
  readonly assessmentVersionId: string;
  readonly draft: number;
  readonly active: number;
  readonly closed: number;
};
export function parseDeliveryAssessmentStatus(
  value: unknown,
  expectedVersion: string,
): DeliveryAssessmentStatus | null {
  if (
    !value || typeof value !== 'object' || !('assessmentVersionId' in value) ||
    value.assessmentVersionId !== expectedVersion ||
    !('draft' in value) || !count(value.draft) || !('active' in value) || !count(value.active) ||
    !('closed' in value) || !count(value.closed)
  ) return null;
  return {
    assessmentVersionId: expectedVersion,
    draft: value.draft,
    active: value.active,
    closed: value.closed,
  };
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
