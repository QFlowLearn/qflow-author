import { isCanonicalUuid } from './uuid.ts';

/** A question's preserved XML and declared answers at one immutable revision. */
export type BankQuestionPreview = {
  readonly itemId: string;
  readonly revision: number;
  readonly title: string;
  readonly xml: string;
  readonly answers: readonly string[];
};

/** Parse only the revision requested by the expanded picker row. */
export function parseBankQuestionPreview(
  value: unknown,
  itemId: string,
  revision: number,
): BankQuestionPreview | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (
    !('itemId' in value) || !('revision' in value) || !('title' in value) ||
    !('xml' in value) || !('answers' in value)
  ) return null;
  if (
    !isCanonicalUuid(value.itemId) || value.itemId !== itemId || value.revision !== revision ||
    typeof value.title !== 'string' || typeof value.xml !== 'string' || !value.xml.trim() ||
    !Array.isArray(value.answers) ||
    !value.answers.every((answer): answer is string => typeof answer === 'string')
  ) return null;
  return { itemId, revision, title: value.title, xml: value.xml, answers: value.answers };
}
