/** Author-facing comparison with the immutable published content. */
export type AssessmentPublicationReview =
  | { readonly status: 'current' | 'unavailable' }
  | {
    readonly status: 'changed';
    readonly structureChanged: boolean;
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly edited: readonly string[];
  };

export function parseAssessmentPublicationReview(
  value: unknown,
): AssessmentPublicationReview | null {
  if (!value || typeof value !== 'object' || !('status' in value)) return null;
  if (value.status === 'current' || value.status === 'unavailable') return { status: value.status };
  if (
    value.status !== 'changed' || !('structureChanged' in value) ||
    typeof value.structureChanged !== 'boolean' ||
    !('added' in value) || !isStringList(value.added) || !('removed' in value) ||
    !isStringList(value.removed) || !('edited' in value) || !isStringList(value.edited)
  ) return null;
  return {
    status: 'changed',
    structureChanged: value.structureChanged,
    added: value.added,
    removed: value.removed,
    edited: value.edited,
  };
}
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
