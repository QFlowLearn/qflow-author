import { readMoodleHints } from './moodle_xml_hints.ts';
import { DOMParser } from '@xmldom/xmldom';
import type { AnswerFeedback } from '../../answer_feedback.ts';
import type { UnlabeledImportDraft } from '../imported_item_qti.ts';
import type { ImportedSourceEvidence, ImportWarning } from '../types.ts';
import {
  attr,
  findAllDescendantsByAnyLocalName,
  findChildByLocalName,
  findDescendantByLocalName,
} from '../xml_dom.ts';
import { type MoodleAssetContext, readMoodleBodyHtml } from './moodle_xml_content.ts';

/** Retain all feedback for review and map only supported whole-response explanations. */
export function readMoodleFeedback(
  type: UnlabeledImportDraft['type'],
  question: Element,
  context: MoodleAssetContext,
  warnings: ImportWarning[],
): { readonly answerFeedback?: AnswerFeedback; readonly sourceEvidence: ImportedSourceEvidence[] } {
  const fields = findAllDescendantsByAnyLocalName(question, [
    'generalfeedback',
    'feedback',
    'correctfeedback',
    'incorrectfeedback',
    'partiallycorrectfeedback',
  ]);
  const evidence: ImportedSourceEvidence[] = [];
  let needsReview = false;
  for (const [index, field] of fields.entries()) {
    const raw = findDescendantByLocalName(field, 'text')?.textContent?.trim() ?? '';
    if (!raw && !field.getElementsByTagName('file').length) continue;
    readMoodleBodyHtml(field, context); // Resolve this field's media and retain missing-file findings.
    evidence.push({
      kind: 'block',
      blockId: `feedback-${index + 1}`,
      quote: raw || 'Source feedback contains an embedded file.',
    });
    if (
      field.parentNode !== question ||
      ((attr(field, 'format') ?? 'html') !== 'plain_text' && /<[^>]+>/.test(raw)) ||
      field.getElementsByTagName('file').length || field.localName === 'partiallycorrectfeedback'
    ) needsReview = true;
  }
  const supported = type === 'single_select' || type === 'multi_select' || type === 'inline_choice';
  const plain = (name: string) => {
    const field = findChildByLocalName(question, name);
    const raw = findDescendantByLocalName(field, 'text')?.textContent ?? '';
    const format = attr(field, 'format') ?? 'html';
    if (format === 'plain_text') return raw.trim();
    if ((format !== 'html' && format !== '') || /<[^>]+>/.test(raw)) return '';
    return new DOMParser().parseFromString(`<div>${raw}</div>`, 'text/html').documentElement
      .textContent?.trim() ?? '';
  };
  const general = plain('generalfeedback');
  const correct = [general, plain('correctfeedback')].filter(Boolean).join('\n\n');
  const incorrect = [general, plain('incorrectfeedback')].filter(Boolean).join('\n\n');
  const answerFeedback = supported && (correct || incorrect)
    ? {
      correct: correct ? { text: correct, link: null, media: null } : null,
      incorrect: incorrect ? { text: incorrect, link: null, media: null } : null,
    }
    : undefined;
  if (evidence.length && (needsReview || !supported)) {
    warnings.push({
      code: 'LMS_CONTENT_REVIEW',
      message:
        'Source feedback is retained in the review evidence and original XML. Recreate answer-specific, rich or partial-response feedback before delivery.',
    });
  }
  evidence.push(...readMoodleHints(question, context, warnings));
  return { ...(answerFeedback ? { answerFeedback } : {}), sourceEvidence: evidence };
}
