import { parseQuestionComposition } from '../authoring/question_composition.ts';
import { questionStemFromSpans, questionTextSpans } from '../authoring/question_text_spans.ts';
import { awaitWithAbortSignal } from '../cancellation.ts';
import { isEnrichmentRecord } from './bank_enrichment_config.ts';
import {
  CLEF_MODEL_ID,
  CLEF_MODEL_VERSION,
  type ClefBinding,
} from './clef_organization_provider.ts';
import type {
  QuestionAssistanceDecision,
  QuestionAssistanceInput,
} from '../authoring/question_assistance.ts';
import { isTextQuestionType } from '../authoring/question_text.ts';

/** Explicit authoring classifier configuration, separate from bank-organization policy. */
export type ClefAuthoringConfig = { readonly gatewayId: string; readonly modelVersion: string };
export type AuthoringAssistanceResult =
  | { readonly ok: true; readonly value: QuestionAssistanceDecision }
  | { readonly ok: false; readonly code: 'unavailable' | 'aborted' | 'invalid_response' };
/** Missing configuration disables remote assistance visibly; no substitute classifier is selected. */
export function loadClefAuthoringConfig(
  read: (key: string) => string | undefined,
): ClefAuthoringConfig | null {
  const gatewayId = read('QFLOW_AUTHORING_GATEWAY_ID');
  const modelVersion = read('QFLOW_AUTHORING_MODEL_VERSION');
  return gatewayId && /^[a-z0-9][a-z0-9-]{0,63}$/.test(gatewayId) &&
      modelVersion === CLEF_MODEL_VERSION
    ? { gatewayId, modelVersion }
    : null;
}
/** Interpret source spans and commands in one bounded Clef evaluation; never generate prose. */
export async function classifyQuestionStructure(
  binding: ClefBinding,
  config: ClefAuthoringConfig,
  input: QuestionAssistanceInput,
  signal: AbortSignal,
): Promise<AuthoringAssistanceResult> {
  if (signal.aborted) return { ok: false, code: 'aborted' };
  if (config.modelVersion !== CLEF_MODEL_VERSION) return { ok: false, code: 'unavailable' };
  const spans = questionTextSpans(input.text);
  if (!spans.length || spans.length > 24) return { ok: true, value: { composition: null } };
  const question = (instructions: string, criteria: Record<string, string>) => ({
    type: 'choice',
    instructions,
    criteria,
  });
  const questions: Record<string, unknown> = {
    structure: question(
      'Which editor structure does the author request? Use current text first. Unsupported or incomplete: uncertain.',
      {
        single_select: 'Select one alternative.',
        multi_select: 'Select several alternatives.',
        text_entry: 'One short typed answer, not an essay.',
        uncertain: 'Ambiguous or unsupported.',
      },
    ),
    count: question(
      'How many answer options does the author request in total? Respect their latest instruction.',
      Object.fromEntries([
        ...Array.from({ length: 9 }, (_, i) => [String(i + 2), `${i + 2} options`]),
        ['unspecified', 'No explicit option count'],
      ]),
    ),
    shuffle: question(
      'Does the author instruct us to randomize answer order? Follow the latest instruction; do not infer a preference.',
      {
        on: 'Explicitly randomize or shuffle.',
        off: 'Explicitly do not randomize or shuffle.',
        unspecified: 'No instruction.',
      },
    ),
    complete: question(
      'Does the author explicitly ask us to supply missing options and propose a correct answer (such as you do the rest)? Do not interpret ordinary question text as a completion request.',
      {
        yes: 'Explicitly requests completion.',
        no: 'No completion request, or says not to complete.',
      },
    ),
  };
  spans.forEach((span, index) => {
    questions[`part_${index}`] = question(
      `Assign the role of source span ${index}: ${
        JSON.stringify(span.text)
      }. Use the whole source as context. Preserve content; classify mixed or unclear spans as uncertain.`,
      {
        stem: 'Question stem or continuation of the stem.',
        choice: 'An answer alternative supplied by the author, including a distractor.',
        answer: 'An explicit answer-key instruction, such as answer is B.',
        command:
          'Only authoring instructions: type, option count, randomization, or completing missing content.',
        uncertain: 'Cannot assign one role without losing information.',
      },
    );
  });
  try {
    const raw = await awaitWithAbortSignal(
      binding.run(CLEF_MODEL_ID, {
        model: CLEF_MODEL_VERSION,
        state: {
          text: input.text,
          spans: spans.map((span) => span.text),
          recentQuestionStructures: input.recent,
        },
        questions,
      }, { gateway: { id: config.gatewayId, skipCache: true, collectLog: false } }),
      { signal },
    );
    if (
      !isEnrichmentRecord(raw) || raw.model !== config.modelVersion ||
      !isEnrichmentRecord(raw.answers)
    ) return { ok: false, code: 'invalid_response' };
    const answers = raw.answers;
    if (Object.keys(answers).sort().join(',') !== Object.keys(questions).sort().join(',')) {
      return { ok: false, code: 'invalid_response' };
    }
    const decisions = new Map<string, string>();
    for (const [key, value] of Object.entries(answers)) {
      if (
        !isEnrichmentRecord(value) || value.type !== 'choice' || typeof value.choice !== 'string' ||
        typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) ||
        value.confidence < 0 || value.confidence > 1
      ) return { ok: false, code: 'invalid_response' };
      if (value.confidence < 0.8 && !(key === 'structure' && input.explicitType)) {
        return { ok: true, value: { composition: null } };
      }
      decisions.set(key, value.choice);
    }
    const type = input.explicitType ?? decisions.get('structure');
    if (!isTextQuestionType(type)) return { ok: true, value: { composition: null } };
    const stem: number[] = [];
    const choices: string[] = [], keys: string[] = [];
    for (const [index, span] of spans.entries()) {
      switch (decisions.get(`part_${index}`)) {
        case 'stem':
          stem.push(index);
          break;
        case 'choice':
          choices.push(span.text.replace(/^([A-Z]|\d{1,2})[.)]\s+/i, ''));
          break;
        case 'answer':
          keys.push(
            span.text.replace(
              /^(?:correct answers?|answer(?: key)?)(?:\s+is|\s+are)?\s*:?\s*/i,
              '',
            ),
          );
          break;
        case 'command':
          break;
        default:
          return { ok: true, value: { composition: null } };
      }
    }
    const selected = keys.map((key) =>
      choices.find((choice) => choice.toLocaleLowerCase() === key.toLocaleLowerCase()) ??
        (/^[A-J]$/i.test(key) ? choices[key.toUpperCase().charCodeAt(0) - 65] : undefined)
    );
    if (type !== 'text_entry' && selected.some((answer) => answer === undefined)) {
      return { ok: true, value: { composition: null } };
    }
    const count = decisions.get('count');
    const shuffle = decisions.get('shuffle');
    const complete = decisions.get('complete');
    if (
      !(count === 'unspecified' || /^(?:[2-9]|10)$/.test(count ?? '')) ||
      !['on', 'off', 'unspecified'].includes(shuffle ?? '') ||
      !['yes', 'no'].includes(complete ?? '')
    ) return { ok: false, code: 'invalid_response' };
    const composition = parseQuestionComposition({
      type,
      stem: questionStemFromSpans(input.text, spans, stem),
      choices,
      answers: type === 'text_entry' ? keys : selected,
      choiceCount: count === 'unspecified'
        ? Math.max(choices.length, input.recent.at(-1)?.choiceCount ?? 4)
        : Number(count),
      shuffle: shuffle === 'unspecified' ? null : shuffle === 'on',
      complete: complete === 'yes',
    });
    return { ok: true, value: { composition } };
  } catch {
    return { ok: false, code: signal.aborted ? 'aborted' : 'unavailable' };
  }
}
