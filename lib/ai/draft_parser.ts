import { createPlaceholderHtml } from '../text_entry_placeholders.ts';
import { sanitizeBodyHtml } from '../sanitize.ts';
import { normalizeDraftForDriver } from '../types/draft_utils.ts';
import type { Draft } from '../types/draft.ts';
import { type QuestionTypeId, TYPE_DRIVERS } from '../types/registry.ts';
import { createTextEntrySlot } from '../types/text_entry.ts';
import type { AIGeneratedSourceCitation } from './generation.ts';
import {
  assessBlueprintCoverage,
  type DefinedAssessmentBlueprint,
  findAssessmentBlueprintTarget,
} from '../assessment_blueprint.ts';
import type { QuestionReviewCategory, QuestionReviewSuggestion } from '../question_review_types.ts';
import { newAuthoringItemLanguage } from '../types/item_language.ts';

type AIGeneratedQuestionType = 'single_select' | 'multi_select' | 'text_entry';

type AIDraftParseError = {
  index: number;
  message: string;
};

export type ParsedAIDraft = {
  index: number;
  typeId: QuestionTypeId;
  title: string;
  normalizedDraft: Record<string, unknown>;
  serializedDraft: Draft;
  blueprintTargetId: string;
  reviewSuggestions: QuestionReviewSuggestion[];
  citations: AIGeneratedSourceCitation[];
};

export type AIDraftParseResult = {
  total: number;
  drafts: ParsedAIDraft[];
};

export class AIDraftParseFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIDraftParseFatalError';
  }
}

export function parseAIGeneratedDrafts(
  content: string,
  blueprint: DefinedAssessmentBlueprint,
): AIDraftParseResult {
  const rawQuestions = extractQuestionArrayFromContent(content);
  const drafts: ParsedAIDraft[] = [];
  const errors: AIDraftParseError[] = [];

  for (const [index, raw] of rawQuestions.entries()) {
    try {
      drafts.push(parseSingleAIDraft(raw, index, blueprint));
    } catch (err) {
      errors.push({ index, message: err instanceof Error ? err.message : 'Unknown parse error.' });
    }
  }

  if (errors.length) {
    throw new AIDraftParseFatalError(
      `The model returned invalid questions. ${formatParseErrors(errors)}`,
    );
  }
  const coverage = assessBlueprintCoverage(
    blueprint,
    drafts.map((draft) => ({
      blueprintTargetId: draft.blueprintTargetId,
      questionType: draft.typeId,
    })),
  );
  if (!coverage.complete) {
    throw new AIDraftParseFatalError(formatCoverageFailure(coverage));
  }

  return {
    total: rawQuestions.length,
    drafts,
  };
}

function parseSingleAIDraft(
  raw: unknown,
  index: number,
  blueprint: DefinedAssessmentBlueprint,
): ParsedAIDraft {
  const obj = asRecord(raw, 'Question entry must be an object.');
  const typeId = parseSupportedType(obj.type);
  assertQuestionKeys(obj, typeId);
  const title = asNonEmptyString(obj.title, 'Question title is required.');
  const bodyHtml = asNonEmptyString(obj.bodyHtml, 'Question bodyHtml is required.');
  const citations = parseCitations(obj.citations);
  const blueprintTargetId = asNonEmptyString(
    obj.blueprintTargetId,
    'Generated question requires blueprintTargetId.',
  );
  const blueprintTarget = findAssessmentBlueprintTarget(blueprint, blueprintTargetId);
  if (!blueprintTarget) {
    throw new Error(
      `Generated question references unknown blueprint target "${blueprintTargetId}".`,
    );
  }
  if (blueprintTarget.questionType !== typeId) {
    throw new Error(
      `Blueprint target "${blueprintTargetId}" requires ${blueprintTarget.questionType}, not ${typeId}.`,
    );
  }
  const reviewSuggestions = parseReviewSuggestions(obj.reviewSuggestions);

  let draft: Draft;
  if (typeId === 'single_select') {
    const choices = parseChoices(obj.choices);
    const correctId = asNonEmptyString(obj.correctId, 'single_select requires correctId.');
    draft = {
      itemLanguage: newAuthoringItemLanguage(),
      type: 'single_select',
      title,
      promptHtml: '',
      bodyHtml: sanitizeBodyHtml(bodyHtml),
      choices,
      correctId,
      shuffle: true,
      required: true,
      tags: ['ai-generated'],
    };
  } else if (typeId === 'multi_select') {
    const choices = parseChoices(obj.choices);
    const correctIds = parseCorrectIds(obj);
    draft = {
      itemLanguage: newAuthoringItemLanguage(),
      type: 'multi_select',
      title,
      promptHtml: '',
      bodyHtml: sanitizeBodyHtml(bodyHtml),
      choices,
      correctIds,
      minChoices: 1,
      maxChoices: choices.length,
      shuffle: true,
      tags: ['ai-generated'],
    };
  } else if (typeId === 'text_entry') {
    const correctAnswers = parseCorrectAnswers(obj);
    if (typeof obj.caseSensitive !== 'boolean') {
      throw new Error('text_entry requires a boolean caseSensitive value.');
    }
    const caseSensitive = obj.caseSensitive;
    const slotId = 'RESPONSE';
    const slot = createTextEntrySlot(slotId, 'Blank 1');
    slot.answers = correctAnswers.map((answer) => ({
      id: crypto.randomUUID(),
      value: answer,
      score: 1,
      caseSensitive,
    }));
    const safeBodyHtml = sanitizeBodyHtml(bodyHtml);
    const placeholder = createPlaceholderHtml({
      id: slot.id,
      label: slot.label,
      widthClass: slot.widthClass,
    });
    draft = {
      itemLanguage: newAuthoringItemLanguage(),
      type: 'text_entry',
      title,
      promptHtml: '',
      bodyHtml: injectTextEntryPlaceholder(safeBodyHtml, placeholder),
      textEntries: [slot],
      tags: ['ai-generated'],
    };
  } else {
    throw new Error(`Unsupported AI question type "${String(typeId)}".`);
  }

  const driver = TYPE_DRIVERS[typeId];
  const normalizedDraft = normalizeDraftForDriver(typeId, draft);
  // SAFETY: draft was constructed for the selected driver immediately above.
  const validation = driver.validate(normalizedDraft as any);
  if (validation.length) {
    throw new Error(validation.join(' '));
  }

  return {
    index,
    typeId,
    title,
    normalizedDraft,
    // SAFETY: validation succeeded for this driver-specific normalized draft.
    serializedDraft: driver.serialize(normalizedDraft as any) as Draft,
    blueprintTargetId,
    reviewSuggestions,
    citations,
  };
}

function formatParseErrors(errors: readonly AIDraftParseError[]): string {
  return errors.map((error) => `Question ${error.index + 1}: ${error.message}`).join(' ');
}

function formatCoverageFailure(
  coverage: ReturnType<typeof assessBlueprintCoverage>,
): string {
  const targets = coverage.targets
    .filter((target) => target.actual !== target.count)
    .map((target) => `${target.id} ${target.actual}/${target.count}`)
    .join(', ');
  return `The model response does not match the blueprint. Unassigned: ${coverage.unassigned}; unknown targets: ${coverage.unknownTarget}; incompatible question types: ${coverage.incompatibleQuestionType}; target counts: ${
    targets || 'matched'
  }.`;
}

function parseReviewSuggestions(value: unknown): QuestionReviewSuggestion[] {
  if (!Array.isArray(value)) {
    throw new Error('Generated question reviewSuggestions must be an array.');
  }
  return value.map((entry, index) => {
    const suggestion = asRecord(entry, `Review suggestion ${index + 1} must be an object.`);
    assertExactKeys(suggestion, ['category', 'message'], `review suggestion ${index + 1}`);
    const category = parseReviewCategory(suggestion.category);
    return {
      source: 'ai',
      code: `ai.${category}`,
      category,
      message: asNonEmptyString(
        suggestion.message,
        `Review suggestion ${index + 1} message is required.`,
      ),
    };
  });
}

function parseReviewCategory(value: unknown): QuestionReviewCategory {
  if (
    value === 'ambiguity' || value === 'clueing' || value === 'duplicate_options' ||
    value === 'answer_key' || value === 'alignment' || value === 'accessibility'
  ) return value;
  throw new Error(`Unsupported review suggestion category "${String(value)}".`);
}

function parseCitations(value: unknown): AIGeneratedSourceCitation[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('Every generated question requires at least one source citation.');
  }
  return value.map((entry) => {
    const citation = asRecord(entry, 'Source citation must be an object.');
    const quote = asNonEmptyString(citation.quote, 'Source citation requires an exact quote.');
    if (citation.kind === 'block') {
      assertExactKeys(citation, ['kind', 'blockId', 'quote'], 'block citation');
      return {
        kind: 'block',
        blockId: asNonEmptyString(citation.blockId, 'Block citation requires blockId.'),
        quote,
      };
    }
    if (citation.kind === 'page') {
      assertExactKeys(citation, ['kind', 'page', 'quote'], 'page citation');
      if (
        typeof citation.page !== 'number' || !Number.isInteger(citation.page) ||
        citation.page < 1
      ) {
        throw new Error('Page citation requires a positive integer page.');
      }
      return { kind: 'page', page: citation.page, quote };
    }
    throw new Error(`Unsupported source citation kind "${String(citation.kind)}".`);
  });
}

function extractQuestionArrayFromContent(content: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    throw new AIDraftParseFatalError('AI response must be a JSON array with no wrapper text.');
  }
  if (!Array.isArray(parsed)) {
    throw new AIDraftParseFatalError('AI response must be a JSON array.');
  }
  return parsed;
}

function parseSupportedType(raw: unknown): AIGeneratedQuestionType {
  const type = asNonEmptyString(raw, 'Question type is required.');
  if (type === 'single_select' || type === 'multi_select' || type === 'text_entry') return type;
  throw new Error(`Unsupported AI question type "${type}".`);
}

function parseChoices(raw: unknown): NonNullable<Draft['choices']> {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error('Question choices must contain at least two options.');
  }
  const choices = raw.map((entry) => {
    const choice = asRecord(entry, 'Choice must be an object.');
    assertExactKeys(choice, ['id', 'text'], 'choice');
    const id = asNonEmptyString(choice.id, 'Choice ID is required.');
    const text = asNonEmptyString(choice.text, 'Choice text is required.');
    return {
      id,
      text,
    };
  });
  if (new Set(choices.map((choice) => choice.id)).size !== choices.length) {
    throw new Error('Choice IDs must be unique.');
  }
  return choices;
}

function parseCorrectIds(obj: Record<string, unknown>): string[] {
  if (!Array.isArray(obj.correctIds) || !obj.correctIds.length) {
    throw new Error('multi_select requires a non-empty correctIds array.');
  }
  const ids = obj.correctIds.map((id) =>
    asNonEmptyString(id, 'Every multi_select correct ID must be a string.')
  );
  if (new Set(ids).size !== ids.length) {
    throw new Error('multi_select correctIds must be unique.');
  }
  return ids;
}

function parseCorrectAnswers(obj: Record<string, unknown>): string[] {
  if (!Array.isArray(obj.correctAnswers) || !obj.correctAnswers.length) {
    throw new Error('text_entry requires a non-empty correctAnswers array.');
  }
  const answers = obj.correctAnswers.map((answer) =>
    asNonEmptyString(answer, 'Every text_entry answer must be a string.')
  );
  if (new Set(answers).size !== answers.length) {
    throw new Error('text_entry correctAnswers must be unique.');
  }
  return answers;
}

function injectTextEntryPlaceholder(bodyHtml: string, placeholder: string): string {
  if (/_ _ _|_{3,}/.test(bodyHtml)) {
    return bodyHtml.replace(/_ _ _|_{3,}/, placeholder);
  }
  if (/\[blank\]/i.test(bodyHtml)) {
    return bodyHtml.replace(/\[blank\]/i, placeholder);
  }
  if (bodyHtml.includes('</p>')) {
    return bodyHtml.replace('</p>', ` ${placeholder}</p>`);
  }
  return `${bodyHtml} ${placeholder}`;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function assertQuestionKeys(
  record: Record<string, unknown>,
  typeId: AIGeneratedQuestionType,
): void {
  const keys = typeId === 'single_select'
    ? [
      'type',
      'title',
      'bodyHtml',
      'choices',
      'correctId',
      'blueprintTargetId',
      'citations',
      'reviewSuggestions',
    ]
    : typeId === 'multi_select'
    ? [
      'type',
      'title',
      'bodyHtml',
      'choices',
      'correctIds',
      'blueprintTargetId',
      'citations',
      'reviewSuggestions',
    ]
    : [
      'type',
      'title',
      'bodyHtml',
      'correctAnswers',
      'caseSensitive',
      'blueprintTargetId',
      'citations',
      'reviewSuggestions',
    ];
  assertExactKeys(record, keys, `${typeId} question`);
}

function assertExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const allowed = new Set(expected);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  const missing = expected.filter((key) => !(key in record));
  if (unknown.length || missing.length) {
    throw new Error(
      `Invalid ${label} keys. Missing: ${missing.join(', ') || 'none'}; unknown: ${
        unknown.join(', ') || 'none'
      }.`,
    );
  }
}

function asNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value.trim();
}
