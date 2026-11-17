import type { QuestionReviewSuggestion } from './question_review_types.ts';
import type { AssessmentArrangementSnapshot } from './assessment_arrangement_version.ts';

/** Project real question references for counts, revisions and scoring, retaining their order. */
export function assessmentQuestionPlacements<T extends object>(
  placements: readonly T[],
): Extract<T, { readonly itemId: string }>[] {
  return placements.filter((placement): placement is Extract<T, { readonly itemId: string }> =>
    'itemId' in placement
  );
}

/** Concrete content checks suitable for a quiet assessment-level suggestion list. */
export type ContentFindingKind =
  | 'conflicting_key'
  | 'choice_key'
  | 'empty_answer'
  | 'duplicate_options'
  | 'image_description'
  | 'colour_reference';

const CHECKS: Readonly<Record<string, ContentFindingKind>> = {
  'answer_key.conflicting_choice_keys': 'conflicting_key',
  'answer_key.single_select_reference': 'choice_key',
  'answer_key.multi_select_reference': 'choice_key',
  'answer_key.text_entry_empty': 'empty_answer',
  'duplicate_options.normalized_text': 'duplicate_options',
  'accessibility.missing_alt_text': 'image_description',
  'accessibility.color_only_instruction': 'colour_reference',
};
const PRIORITY: Readonly<Record<ContentFindingKind, number>> = {
  conflicting_key: 0,
  choice_key: 0,
  empty_answer: 0,
  duplicate_options: 1,
  image_description: 2,
  colour_reference: 2,
};

/** A localized finding references a saved placement; it never changes export eligibility. */
export type AssessmentContentFinding = Readonly<{
  key: string;
  placementId: string;
  number: string;
  title: string;
  kind: ContentFindingKind;
}>;

/** Collect only supported deterministic findings across every current assessment placement. */
export function collectAssessmentContentFindings(
  parts: readonly { readonly placements: readonly { readonly id: string }[] }[],
  metadata: Readonly<
    Record<string, {
      readonly title: string;
      readonly latestRev: number;
      readonly reviewSuggestions: readonly QuestionReviewSuggestion[];
    }>
  >,
): readonly AssessmentContentFinding[] {
  const findings: AssessmentContentFinding[] = [];
  for (const [partIndex, part] of parts.entries()) {
    for (const [itemIndex, placement] of part.placements.entries()) {
      const meta = metadata[placement.id];
      if (!meta) throw new Error('Saved question metadata is required for assessment checks.');
      const seen = new Set<ContentFindingKind>();
      for (const suggestion of meta.reviewSuggestions) {
        if (suggestion.source !== 'deterministic') continue;
        const kind = Object.hasOwn(CHECKS, suggestion.code) ? CHECKS[suggestion.code] : undefined;
        if (!kind || seen.has(kind)) continue;
        seen.add(kind);
        findings.push({
          key: `${placement.id}:${meta.latestRev}:${kind}`,
          placementId: placement.id,
          number: `${partIndex + 1}.${itemIndex + 1}`,
          title: meta.title,
          kind,
        });
      }
    }
  }
  return findings.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
}

/** Stable in-page destination shared by findings and the existing question canvas. */
export function assessmentQuestionAnchor(placementId: string): string {
  return `assessment-question-${placementId}`;
}

/** Detect saved structural/content changes when refreshing publication status. */
export function assessmentRevisionFingerprint(
  parts: AssessmentArrangementSnapshot,
  itemMeta: Readonly<Record<string, { readonly latestRev: number }>>,
): string {
  return JSON.stringify(parts.map((part) => ({
    id: part.id,
    title: part.title,
    options: part.options,
    placements: part.placements.map((placement) =>
      'content' in placement ? placement : ({
        id: placement.id,
        itemId: placement.itemId,
        revision: placement.snapshotRev ?? itemMeta[placement.id]?.latestRev ?? null,
        blueprintTargetId: placement.blueprintTargetId ?? null,
        fixed: placement.fixed === true,
      })
    ),
  })));
}
