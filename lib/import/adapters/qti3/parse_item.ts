import { readAuthoredAnswerFeedback } from '../../../answer_feedback_qti.ts';
import { parseQtiXml } from '@longsightgroup/qti3-core';
import { type ParsedItemDraft, qtiDocumentToDraft } from './qti_document_to_draft.ts';
import { importChoicePoints, QtiChoicePointsImportError } from './choice_points.ts';
import { QtiItemLanguageImportError } from './qti_import_support.ts';
export { QtiItemLanguageImportError } from './qti_import_support.ts';

export function parseItemXml(xml: string): ParsedItemDraft {
  return projectParsedItem(xml, parseQtiXml(xml));
}

function projectParsedItem(xml: string, parsed: ReturnType<typeof parseQtiXml>): ParsedItemDraft {
  if (!parsed.document) {
    const message = parsed.diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => diagnostic.message)
      .join('; ') || 'Failed to parse QTI item XML';
    throw new Error(message);
  }
  const mapped = qtiDocumentToDraft(parsed.document);
  const answerFeedback = readAuthoredAnswerFeedback(parsed.document.item);
  const draft = answerFeedback ? { ...mapped.draft, answerFeedback } : mapped.draft;
  const points = importChoicePoints(xml, parsed.document.item, draft, parsed.ok);
  if (!points.ok) throw points.error;
  return { ...mapped, draft: points.draft };
}

/** Read-only source authority used before a point edit can regenerate imported processing. */
export type ChoicePointEditability =
  | { readonly _tag: 'Editable'; readonly maximumScore: number | undefined }
  | { readonly _tag: 'SourceOnly' };

/** Inspect the stored program without changing a saved draft or inferring a maximum. */
export function recognizeEditableChoiceSource(xml: string): ChoicePointEditability {
  const parsed = parseQtiXml(xml);
  const item = parsed.document?.item;
  if (
    !parsed.ok || !item || item.interactions.length === 0 ||
    item.interactions.some((interaction) =>
      interaction.type !== 'choice' && interaction.type !== 'inlineChoice'
    )
  ) return { _tag: 'SourceOnly' };
  try {
    const mapped = projectParsedItem(xml, parsed);
    return { _tag: 'Editable', maximumScore: mapped.draft.maximumScore };
  } catch (cause: unknown) {
    if (
      cause instanceof QtiChoicePointsImportError || cause instanceof QtiItemLanguageImportError
    ) {
      return { _tag: 'SourceOnly' };
    }
    throw cause;
  }
}
