/** The published export is compared with the current canonical assessment content. */
export type AssessmentPublicationStatus = 'current' | 'changed' | 'unavailable';

/** Read only the identity needed for comparison, scoped to the expected receipt and assessment. */
export function publishedCanonicalRevision(
  input: unknown,
  assessmentId: string,
  receiptId: string,
): string | null {
  if (
    !input || typeof input !== 'object' || !('schema' in input) ||
    input.schema !== 'qflow.export-receipt.v1' || !('receiptId' in input) ||
    input.receiptId !== receiptId || !('assessment' in input)
  ) return null;
  const assessment = input.assessment;
  if (
    !assessment || typeof assessment !== 'object' || !('id' in assessment) ||
    assessment.id !== assessmentId || !('canonicalRevisionId' in assessment)
  ) return null;
  const revision = assessment.canonicalRevisionId;
  return typeof revision === 'string' && /^[0-9a-f]{64}$/.test(revision) ? revision : null;
}
