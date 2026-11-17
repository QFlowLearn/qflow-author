import type { UnlabeledImportDraft } from '../imported_item_qti.ts';
import type { ImportWarning } from '../types.ts';
import { attr, findChildByLocalName } from '../xml_dom.ts';
/** Apply Moodle's explicit default mark once at the import boundary. */
export function applyMoodlePoints(
  draft: UnlabeledImportDraft,
  question: Element,
  warnings: ImportWarning[],
): void {
  const element = findChildByLocalName(question, 'defaultgrade');
  if (attr(question, 'type') === 'cloze') {
    // Moodle derives the total from blank weights and omits defaultgrade when exporting Cloze.
    if (element) {
      const total = draft.type === 'text_entry'
        ? (draft.textEntries ?? []).reduce(
          (sum, slot) => sum + Math.max(0, ...slot.answers.map((answer) => answer.score ?? 0)),
          0,
        )
        : (draft.inlineChoices ?? []).reduce(
          (sum, slot) => sum + Math.max(0, ...slot.options.map((option) => option.score ?? 0)),
          0,
        );
      const raw = element.textContent?.trim() ?? '';
      if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) !== total) {
        warnings.push({
          code: 'LMS_SCORING_REVIEW',
          message:
            `Cloze header defaultgrade ${raw} conflicts with the ${total} points derived from blank weights. Correct the source header or weights and import again.`,
        });
      }
    }
    return;
  }
  if (!element) return; // Moodle's omitted default mark is one point.
  const raw = element.textContent?.trim() ?? '';
  const points = Number(raw);
  if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(points)) {
    warnings.push({
      code: 'LMS_SCORING_REVIEW',
      message: 'Source defaultgrade must be a finite non-negative number.',
    });
    return;
  }
  if (draft.type === 'single_select' || draft.type === 'multi_select') draft.maximumScore = points;
  else if (draft.type === 'text_entry') {
    for (const slot of draft.textEntries ?? []) {
      for (const answer of slot.answers) answer.score = (answer.score ?? 1) * points;
    }
  } else if (draft.type === 'extended_text') {
    draft.rubricHtml = `${
      draft.rubricHtml ?? ''
    }<p>Manual grading. Source maximum: ${points} points.</p>`;
    warnings.push({
      code: 'LMS_MANUAL_POINTS_REVIEW',
      message: `Configure the source manual ceiling of ${points} points in delivery.`,
    });
  } else if (points !== 1) {
    warnings.push({
      code: 'LMS_SCORING_REVIEW',
      message:
        `Source maximum ${points} points requires explicit scoring configuration for this interaction.`,
    });
  }
}

/** Only equal positive weights with no penalties fit the generated choice mapping. */
export function moodleChoiceScoring(
  fractions: readonly number[],
  single: boolean,
  warnings: ImportWarning[],
): 'partial' | 'all_or_nothing' {
  const positive = fractions.filter((value) => value > 0);
  const partial = fractions.some((value) => value !== 0 && value !== 100);
  const representable = single
    ? positive.length === 1 && positive[0] === 100 &&
      fractions.every((value) => value === 0 || value === 100)
    : positive.length > 0 && fractions.every((value) => value >= 0) &&
      positive.every((value) => Math.abs(value - 100 / positive.length) < 0.0001);
  if (!representable) {
    warnings.push({
      code: 'LMS_SCORING_REVIEW',
      message: `Source answer percentages (${
        fractions.join(', ')
      }) need explicit scoring reconstruction; unequal weights and penalties are not supported by this draft.`,
    });
  }
  return partial ? 'partial' : 'all_or_nothing';
}
