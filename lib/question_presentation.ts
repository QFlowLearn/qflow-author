import type { Draft } from './types/draft.ts';
import { createInlineChoiceMarkerHtml, standaloneInlineChoice } from './types/inline_choice.ts';
import { isValidQtiIdentifier } from './qti_identifiers.ts';

/** The two interchangeable presentations for an ordinary single-answer question. */
export type QuestionPresentationType = 'single_select' | 'inline_choice';

/** Why changing presentation would require discarding authored information. */
export type QuestionPresentationBlock =
  | 'structure'
  | 'richAnswers'
  | 'scoring'
  | 'settings'
  | 'imported';

/** A presentation change preserves common metadata and only projects interaction fields. */
export type QuestionPresentationResult =
  | { readonly ok: true; readonly draft: Draft }
  | { readonly ok: false; readonly reason: QuestionPresentationBlock };

/** Classify and convert without mutating the source or inventing a correct answer. */
export function changeQuestionPresentation(draft: Draft): QuestionPresentationResult {
  if (draft.type !== 'single_select' && draft.type !== 'inline_choice') {
    return { ok: false, reason: 'structure' };
  }
  if (draft.preserveSourceXml || draft.importWarnings?.length) {
    return { ok: false, reason: 'imported' };
  }
  if (
    draft.customResponseProcessingXml ||
    (draft.responseMode && draft.responseMode !== 'all_or_nothing')
  ) {
    return { ok: false, reason: 'scoring' };
  }
  if (
    draft.answerMasking ||
    Object.values(draft.sharedVocabulary ?? {}).some((value) => value !== undefined) ||
    draft.minChoicesMessage || draft.maxChoicesMessage ||
    (draft.responseIdentifier && draft.responseIdentifier !== 'RESPONSE')
  ) {
    return { ok: false, reason: 'settings' };
  }
  const {
    choices,
    correctId,
    inlineChoices,
    shuffle,
    required,
    minChoices,
    maxChoices,
    answerMasking: _answerMasking,
    responseIdentifier: _responseIdentifier,
    ...common
  } = draft;
  if (draft.type === 'single_select') {
    if (
      (minChoices !== undefined && minChoices !== 0 && minChoices !== 1) ||
      (maxChoices !== undefined && maxChoices !== 1) ||
      (minChoices === 0 && required === true) || (minChoices === 1 && required === false)
    ) {
      return { ok: false, reason: 'settings' };
    }
    if (!choices?.length || (draft.bodyHtml ?? '').includes('data-qti-inline-choice')) {
      return { ok: false, reason: 'structure' };
    }
    if (choices.some((choice) => choice.html?.trim() || choice.kind === 'image' || choice.imgSrc)) {
      return { ok: false, reason: 'richAnswers' };
    }
    if (
      choices.some((choice) =>
        choice.label || choice.matchMax !== undefined || (choice.fixed && !shuffle)
      )
    ) {
      return { ok: false, reason: 'settings' };
    }
    if (!validOptions(choices)) return { ok: false, reason: 'structure' };
    const slot = {
      id: 'RESPONSE',
      label: 'RESPONSE',
      options: choices,
      correctId,
      shuffle,
      required: minChoices === undefined ? required ?? true : minChoices === 1,
    };
    return {
      ok: true,
      draft: {
        ...common,
        type: 'inline_choice',
        bodyHtml: `${draft.bodyHtml ?? ''}<p>${createInlineChoiceMarkerHtml(slot)}</p>`,
        inlineChoices: [slot],
      },
    };
  }
  const standalone = standaloneInlineChoice({
    bodyHtml: draft.bodyHtml,
    inlineChoices: inlineChoices ?? [],
  });
  if (!standalone) return { ok: false, reason: 'structure' };
  const { slot } = standalone;
  if (
    slot.id !== 'RESPONSE' || slot.widthClass || slot.writingOrientation ||
    slot.options.some((option) => option.fixed && !slot.shuffle)
  ) {
    return { ok: false, reason: 'settings' };
  }
  if (slot.options.some((option) => option.score !== undefined)) {
    return { ok: false, reason: 'scoring' };
  }
  if (slot.options.some((option) => option.html?.trim())) {
    return { ok: false, reason: 'richAnswers' };
  }
  if (!validOptions(slot.options)) return { ok: false, reason: 'structure' };
  return {
    ok: true,
    draft: {
      ...common,
      type: 'single_select',
      bodyHtml: standalone.questionHtml,
      choices: slot.options,
      correctId: slot.correctId ?? '',
      shuffle: slot.shuffle,
      required: slot.required ?? false,
    },
  };
}

function validOptions(options: readonly { readonly id: string }[]): boolean {
  return options.every((option) => isValidQtiIdentifier(option.id)) &&
    new Set(options.map((option) => option.id)).size === options.length;
}

const interactionFields = [
  'type',
  'bodyHtml',
  'choices',
  'correctId',
  'inlineChoices',
  'shuffle',
  'required',
  'minChoices',
  'maxChoices',
  'answerMasking',
  'responseIdentifier',
] as const;

/** Local interaction history, deliberately excluding title, prompt and common metadata. */
export type QuestionPresentationHistory = {
  readonly before: Pick<Draft, typeof interactionFields[number]>;
  readonly after: Pick<Draft, typeof interactionFields[number]>;
};

/** Capture only fields owned by the presentation transition for a local Undo operation. */
export function questionPresentationHistory(
  before: Draft,
  after: Draft,
): QuestionPresentationHistory {
  const project = (draft: Draft) =>
    Object.fromEntries(
      interactionFields
        .filter((field) => Object.hasOwn(draft, field)).map((field) => [field, draft[field]]),
    );
  return { before: project(before), after: project(after) };
}

/** Undo the representation change while preserving later text, answers and metadata edits. */
export function undoQuestionPresentation(
  current: Draft,
  history: QuestionPresentationHistory,
): QuestionPresentationResult {
  if (current.type !== history.after.type) return { ok: false, reason: 'structure' };
  const converted = changeQuestionPresentation(current);
  if (!converted.ok) return converted;
  const fields = interactionFields.filter((field) => field !== 'bodyHtml' && field !== 'type');
  const unchangedInteraction = fields.every((field) =>
    JSON.stringify(current[field]) === JSON.stringify(history.after[field])
  );
  const result = { ...converted.draft };
  if (unchangedInteraction) {
    for (const field of fields) {
      if (Object.hasOwn(history.before, field)) {
        Object.assign(result, { [field]: history.before[field] });
      } else Reflect.deleteProperty(result, field);
    }
  }
  if (current.bodyHtml === history.after.bodyHtml) {
    if (Object.hasOwn(history.before, 'bodyHtml')) result.bodyHtml = history.before.bodyHtml;
    else Reflect.deleteProperty(result, 'bodyHtml');
  }
  return { ok: true, draft: result };
}
