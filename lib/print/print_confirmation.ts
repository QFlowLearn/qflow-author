/** Confirmation explicitly identifies both reviewed PDF files and their source; null is invalid. */
export type PrintConfirmation = {
  readonly candidateDigest: string;
  readonly sourceDigest: string;
  readonly studentSha256: string;
  readonly markingSha256: string;
};
export function parsePrintConfirmation(input: unknown): PrintConfirmation | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = Object.fromEntries(Object.entries(input));
  if (
    Object.keys(value).length !== 4 || !hash(value.candidateDigest) || !hash(value.sourceDigest) ||
    !hash(value.studentSha256) || !hash(value.markingSha256)
  ) return null;
  return {
    candidateDigest: value.candidateDigest,
    sourceDigest: value.sourceDigest,
    studentSha256: value.studentSha256,
    markingSha256: value.markingSha256,
  };
}

function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
