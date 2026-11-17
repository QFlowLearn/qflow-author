import type { OpenRouterMode } from './openrouter.ts';
import {
  assessmentBlueprintQuestionCount,
  type DefinedAssessmentBlueprint,
} from '../assessment_blueprint.ts';

const SUPPORTED_AI_PROMPT_TYPES = ['single_select', 'multi_select', 'text_entry'] as const;
export type AIPromptQuestionType = typeof SUPPORTED_AI_PROMPT_TYPES[number];
const DEFAULT_SOURCE_MATERIAL_PROMPT_CHARS = 6000;
export const FILE_SOURCE_MATERIAL_PROMPT_CHARS = 24000;
/** Version of the complete assessment-generation instruction contract. */
export const ASSESSMENT_GENERATION_PROMPT_VERSION = 'qflow.assessment-generation.v1';

export type AssessmentGenerationPromptInput = {
  blueprint: DefinedAssessmentBlueprint;
  gradeLevel: string;
  brief: string;
  sourceMaterial: string;
  sourceMaterialMaxChars?: number;
  evidenceMode: 'block' | 'page';
  existingQuestions?: ExistingQuestionPromptContext[];
};

/** Source reference emitted by the model for one generated question. */
export type AIGeneratedSourceCitation =
  | { readonly kind: 'block'; readonly blockId: string; readonly quote: string }
  | { readonly kind: 'page'; readonly page: number; readonly quote: string };

export type ExistingQuestionPromptContext = {
  type: string;
  title: string;
  prompt: string;
};

export type AIGenerationUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type PromptSourceMaterialStats = {
  totalChars: number;
  includedChars: number;
  maxChars: number;
  truncated: boolean;
};

export type AIGenerationParserInput = {
  source: 'openrouter_chat_completions' | 'cloudflare_workers_ai';
  mode: OpenRouterMode;
  model: string;
  content: string;
  usage: AIGenerationUsage;
  raw: unknown;
};

export class OpenRouterGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenRouterGenerationError';
  }
}

export function buildAssessmentGenerationPrompt(input: AssessmentGenerationPromptInput): string {
  const brief = input.brief.trim();
  const scope = brief ? brief : 'No additional brief provided.';
  const source = sourceMaterialForPrompt(
    input.sourceMaterial,
    input.sourceMaterialMaxChars,
  ).text ||
    'No additional source content provided.';
  const count = assessmentBlueprintQuestionCount(input.blueprint);
  const types = dedupePromptTypes(input.blueprint.targets.map((target) => {
    if (!SUPPORTED_AI_PROMPT_TYPES.some((type) => type === target.questionType)) {
      throw new Error(`AI generation does not support blueprint type ${target.questionType}.`);
    }
    return target.questionType as AIPromptQuestionType;
  }));
  const typeLine = types.map((t) => `"${t}"`).join(', ');
  const schemaBlock = types.map((type) => QUESTION_TYPE_SCHEMAS[type]).join('\n');
  const examples = types.map((type) => {
    const target = input.blueprint.targets.find((candidate) => candidate.questionType === type);
    if (!target) throw new Error(`Blueprint is missing target for ${type}.`);
    return QUESTION_TYPE_EXAMPLES[type].replaceAll('__BLUEPRINT_TARGET_ID__', target.id);
  }).join('\n');
  const citationRule = input.evidenceMode === 'page'
    ? 'Cite the exact PDF page and a short verbatim quote: {"kind":"page","page":1,"quote":"..."}.'
    : 'Cite a provided block ID and an exact quote from that block: {"kind":"block","blockId":"block-1","quote":"..."}.';
  const existingQuestions = (input.existingQuestions ?? []).slice(0, 50);
  const existingQuestionLines = existingQuestions.map((question, index) =>
    `${index + 1}. [${question.type}] ${question.title} :: ${question.prompt}`
  );
  const hasExistingQuestions = existingQuestionLines.length > 0;

  return [
    'You are an expert educational assessment designer.',
    'Generate machine-parseable JSON only.',
    '',
    'CONTEXT',
    `- Question count: ${count}`,
    `- Grade level: ${input.gradeLevel}`,
    `- Allowed question types: [${typeLine}]`,
    `- Assessment brief: ${scope}`,
    '- Blueprint targets:',
    ...input.blueprint.targets.map((target) => {
      const outcome = input.blueprint.outcomes.find((entry) => entry.id === target.outcomeId);
      if (!outcome) throw new Error(`Blueprint target ${target.id} has no outcome.`);
      return `  - ${target.id}: exactly ${target.count} ${target.questionType}; outcome "${outcome.title}"; ${target.cognitiveDemand}; ${target.difficulty}`;
    }),
    '',
    'SOURCE MATERIAL',
    source,
    '',
    'REQUIREMENTS',
    '1. Every question must be directly answerable from the provided context.',
    '2. Use age-appropriate vocabulary for the grade level.',
    '3. Match each question to one blueprint target, including its outcome, cognitive demand, and difficulty intent.',
    '4. Avoid trick wording, ambiguity, and opinions.',
    '5. Each question should test a distinct concept.',
    '6. For choice questions, provide plausible distractors that are clearly incorrect.',
    '7. Do not use "all of the above" or "none of the above".',
    `8. ${citationRule}`,
    ...(hasExistingQuestions
      ? ['9. Do not duplicate or closely paraphrase any existing question listed below.']
      : []),
    '',
    ...(hasExistingQuestions
      ? [
        'EXISTING QUESTIONS IN THIS ASSESSMENT (avoid duplicates):',
        ...existingQuestionLines,
        '',
      ]
      : []),
    'OUTPUT RULES',
    '1. Return a JSON array with the exact count requested for every blueprint target.',
    '2. Do not wrap output in markdown or code fences.',
    '3. Do not include commentary or extra keys outside schemas.',
    '4. Use only allowed `type` values listed above.',
    '5. `bodyHtml` must be valid simple HTML (typically a single <p>...</p>).',
    '6. Every object must include its exact `blueprintTargetId`.',
    '7. Every object must include a non-empty `citations` array using the required citation shape.',
    '8. Put possible ambiguity, clueing, alignment, or accessibility concerns in `reviewSuggestions`. Do not silently rewrite after reporting a concern.',
    '',
    'QUESTION SCHEMAS',
    schemaBlock,
    '',
    'FEW-SHOT EXAMPLES',
    examples,
    '',
    'Return only the JSON array now.',
  ].join('\n');
}

export function sourceMaterialForPrompt(
  value: string,
  maxChars = DEFAULT_SOURCE_MATERIAL_PROMPT_CHARS,
): { text: string; stats: PromptSourceMaterialStats } {
  const normalizedMax = normalizeSourceMaterialMaxChars(maxChars);
  const trimmed = value.trim();
  const totalChars = trimmed.length;
  if (!trimmed) {
    return {
      text: '',
      stats: {
        totalChars: 0,
        includedChars: 0,
        maxChars: normalizedMax,
        truncated: false,
      },
    };
  }
  if (totalChars <= normalizedMax) {
    return {
      text: trimmed,
      stats: {
        totalChars,
        includedChars: totalChars,
        maxChars: normalizedMax,
        truncated: false,
      },
    };
  }
  const clipped = trimmed.slice(0, normalizedMax).trimEnd();
  return {
    text: `${clipped}\n...[truncated]`,
    stats: {
      totalChars,
      includedChars: clipped.length,
      maxChars: normalizedMax,
      truncated: true,
    },
  };
}

export function mapOpenRouterChatCompletionToParserInput(
  payload: unknown,
  mode: OpenRouterMode,
): AIGenerationParserInput {
  const obj = asRecord(payload, 'OpenRouter response payload must be an object.');
  const model = asNonEmptyString(obj.model, 'OpenRouter response missing model.');
  const choices = asArray(obj.choices, 'OpenRouter response missing choices array.');
  if (!choices.length) {
    throw new OpenRouterGenerationError('OpenRouter response choices array was empty.');
  }

  const firstChoice = asRecord(
    choices[0],
    'OpenRouter response first choice is not an object.',
  );
  const message = asRecord(
    firstChoice.message,
    'OpenRouter response first choice missing message object.',
  );
  const content = parseMessageContent(message.content);
  if (!content) {
    throw new OpenRouterGenerationError('OpenRouter response message content was empty.');
  }

  const usageObj = obj.usage && typeof obj.usage === 'object'
    ? obj.usage as Record<string, unknown>
    : {};

  return {
    source: 'openrouter_chat_completions',
    mode,
    model,
    content,
    usage: {
      promptTokens: asOptionalNumber(usageObj.prompt_tokens),
      completionTokens: asOptionalNumber(usageObj.completion_tokens),
      totalTokens: asOptionalNumber(usageObj.total_tokens),
    },
    raw: payload,
  };
}

function parseMessageContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  const textParts: string[] = [];
  for (const part of value) {
    if (!part || typeof part !== 'object') continue;
    const asObj = part as Record<string, unknown>;
    if (asObj.type === 'text' && typeof asObj.text === 'string') {
      textParts.push(asObj.text);
    }
  }
  return textParts.join('').trim();
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenRouterGenerationError(message);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new OpenRouterGenerationError(message);
  }
  return value;
}

function asNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OpenRouterGenerationError(message);
  }
  return value.trim();
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function dedupePromptTypes(types: AIPromptQuestionType[]): AIPromptQuestionType[] {
  const allowed = new Set(SUPPORTED_AI_PROMPT_TYPES);
  if (!types.length) throw new Error('At least one AI question type is required.');
  if (types.some((type) => !allowed.has(type))) {
    throw new Error('AI question types contain an unsupported value.');
  }
  return Array.from(new Set(types));
}

function normalizeSourceMaterialMaxChars(value: number): number {
  if (!Number.isFinite(value) || value < 1000) {
    throw new Error('AI source material limit must be at least 1000 characters.');
  }
  return Math.max(1000, Math.round(value));
}

const QUESTION_TYPE_SCHEMAS: Record<AIPromptQuestionType, string> = {
  single_select: [
    '{',
    '  "type": "single_select",',
    '  "title": "string",',
    '  "bodyHtml": "<p>Question prompt</p>",',
    '  "choices": [',
    '    { "id": "A", "text": "Option A" },',
    '    { "id": "B", "text": "Option B" },',
    '    { "id": "C", "text": "Option C" },',
    '    { "id": "D", "text": "Option D" }',
    '  ],',
    '  "correctId": "A",',
    '  "blueprintTargetId": "exact target ID from the blueprint",',
    '  "reviewSuggestions": [{ "category": "ambiguity", "message": "Concern for the author to review" }],',
    '  "citations": [{ "kind": "block", "blockId": "block-1", "quote": "exact source quote" }]',
    '}',
  ].join('\n'),
  multi_select: [
    '{',
    '  "type": "multi_select",',
    '  "title": "string",',
    '  "bodyHtml": "<p>Question prompt</p>",',
    '  "choices": [',
    '    { "id": "A", "text": "Option A" },',
    '    { "id": "B", "text": "Option B" },',
    '    { "id": "C", "text": "Option C" },',
    '    { "id": "D", "text": "Option D" }',
    '  ],',
    '  "correctIds": ["A", "C"],',
    '  "blueprintTargetId": "exact target ID from the blueprint",',
    '  "reviewSuggestions": [],',
    '  "citations": [{ "kind": "block", "blockId": "block-1", "quote": "exact source quote" }]',
    '}',
  ].join('\n'),
  text_entry: [
    '{',
    '  "type": "text_entry",',
    '  "title": "string",',
    '  "bodyHtml": "<p>Question prompt</p>",',
    '  "correctAnswers": ["primary answer", "acceptable variant"],',
    '  "caseSensitive": false,',
    '  "blueprintTargetId": "exact target ID from the blueprint",',
    '  "reviewSuggestions": [],',
    '  "citations": [{ "kind": "block", "blockId": "block-1", "quote": "exact source quote" }]',
    '}',
  ].join('\n'),
};

const QUESTION_TYPE_EXAMPLES: Record<AIPromptQuestionType, string> = {
  single_select: [
    '[',
    '  {',
    '    "type": "single_select",',
    '    "title": "Cell Organelle Function",',
    '    "bodyHtml": "<p>Which organelle is primarily responsible for producing ATP in eukaryotic cells?</p>",',
    '    "choices": [',
    '      { "id": "A", "text": "Nucleus" },',
    '      { "id": "B", "text": "Mitochondrion" },',
    '      { "id": "C", "text": "Ribosome" },',
    '      { "id": "D", "text": "Golgi apparatus" }',
    '    ],',
    '    "correctId": "B",',
    '    "blueprintTargetId": "__BLUEPRINT_TARGET_ID__",',
    '    "reviewSuggestions": [],',
    '    "citations": [{ "kind": "block", "blockId": "block-1", "quote": "exact source quote" }]',
    '  }',
    ']',
  ].join('\n'),
  multi_select: [
    '[',
    '  {',
    '    "type": "multi_select",',
    '    "title": "Photosynthesis Inputs",',
    '    "bodyHtml": "<p>Select all materials plants need to perform photosynthesis.</p>",',
    '    "choices": [',
    '      { "id": "A", "text": "Sunlight" },',
    '      { "id": "B", "text": "Carbon dioxide" },',
    '      { "id": "C", "text": "Nitrogen gas" },',
    '      { "id": "D", "text": "Water" }',
    '    ],',
    '    "correctIds": ["A", "B", "D"],',
    '    "blueprintTargetId": "__BLUEPRINT_TARGET_ID__",',
    '    "reviewSuggestions": [],',
    '    "citations": [{ "kind": "block", "blockId": "block-1", "quote": "exact source quote" }]',
    '  }',
    ']',
  ].join('\n'),
  text_entry: [
    '[',
    '  {',
    '    "type": "text_entry",',
    '    "title": "Energy Conversion Vocabulary",',
    '    "bodyHtml": "<p>In cellular respiration, glucose is converted into usable cellular ____.</p>",',
    '    "correctAnswers": ["energy", "ATP"],',
    '    "caseSensitive": false,',
    '    "blueprintTargetId": "__BLUEPRINT_TARGET_ID__",',
    '    "reviewSuggestions": [],',
    '    "citations": [{ "kind": "block", "blockId": "block-1", "quote": "exact source quote" }]',
    '  }',
    ']',
  ].join('\n'),
};
