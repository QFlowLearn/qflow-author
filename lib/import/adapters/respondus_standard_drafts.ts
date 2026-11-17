import { normalizeQtiIdentifier } from '../../qti_identifiers.ts';
import { sanitizeBodyHtml } from '../../sanitize.ts';
import { createPlaceholderHtml } from '../../text_entry_placeholders.ts';
import type { UnlabeledImportDraft } from '../imported_item_qti.ts';
import { xmlEscape } from '../../xml.ts';
import type { ImportedItem, ImportedSourceEvidence, ImportWarning } from '../types.ts';
import { buildImportedItem } from '../imported_item_qti.ts';
import type {
  RespondusParsedChoice,
  RespondusParsedQuestion,
} from './respondus_standard_parser.ts';

/** One imported item and every review diagnostic produced while mapping it. */
export type RespondusBuiltItem = {
  readonly item: ImportedItem;
  readonly warnings: readonly ImportWarning[];
};

/** Map a parsed Respondus question into one canonical QFlow draft. */
export function buildRespondusImportedItem(
  question: RespondusParsedQuestion,
): RespondusBuiltItem {
  const href = `respondus/question-${question.number}.xml`;
  const title = question.title ?? defaultTitle(question.prompt, question.number);
  const identifier = normalizeQtiIdentifier(title, `RESPONDUS_${question.number}`);
  const warnings: ImportWarning[] = question.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    detail: `Line ${issue.line}`,
    path: href,
  }));
  appendRespondusSourceFeatureWarnings(question, href, warnings);

  const item = buildImportedItem({
    sourceFormat: 'respondus',
    draft: draftForQuestion(question, title, href, warnings),
    identifier,
    title,
    sourceText: question.prompt,
    href,
    sourceEvidence: collectRespondusEvidence(question),
  });
  return {
    item,
    warnings,
  };
}

function draftForQuestion(
  question: RespondusParsedQuestion,
  title: string,
  href: string,
  warnings: ImportWarning[],
): UnlabeledImportDraft {
  switch (question.kind) {
    case 'choice':
      return buildChoiceUnlabeledImportDraft(question, title, href, warnings, 'single');
    case 'multiple_answer':
      return buildChoiceUnlabeledImportDraft(question, title, href, warnings, 'multiple');
    case 'fill_blank':
      return buildFillBlankUnlabeledImportDraft(question, title, href, warnings);
    case 'essay':
      return buildEssayUnlabeledImportDraft(question, title, href, warnings);
    case 'matching':
      return buildMatchingUnlabeledImportDraft(question, title, href, warnings);
    case 'unsupported':
      warnings.push({
        code: 'UNSUPPORTED_ITEM_STUBBED',
        message: `Respondus question type "${question.typeCode ?? 'unknown'}" is not supported.`,
        path: href,
      });
      return {
        type: 'extended_text',
        title,
        bodyHtml: toBodyHtml(question.prompt),
        responseIdentifier: 'RESPONSE',
        expectedLength: 200,
        expectedLines: 6,
        minStrings: 1,
        maxStrings: 1,
        format: 'plain',
        responseBaseType: 'string',
        responseCardinality: 'single',
        heightClass: 'qti-height-lines-6',
        counterType: 'none',
        rubricHtml: '',
        tags: ['imported', 'respondus'],
      };
  }
}

function buildChoiceUnlabeledImportDraft(
  question: RespondusParsedQuestion,
  title: string,
  href: string,
  warnings: ImportWarning[],
  cardinality: 'single' | 'multiple',
): UnlabeledImportDraft {
  const choices = question.choices.map((choice) => ({
    id: choice.label,
    text: choice.text,
  }));
  if (choices.length < 2) {
    warnings.push({
      code: 'RESPONDUS_CHOICES_INCOMPLETE',
      message: 'Respondus choice questions require at least two answer choices.',
      path: href,
    });
  }
  const correctIds = resolveChoiceKeys(question, cardinality, href, warnings);
  if (cardinality === 'single') {
    return {
      type: 'single_select',
      title,
      bodyHtml: toBodyHtml(question.prompt),
      choices,
      correctId: correctIds[0] ?? '',
      shuffle: false,
      tags: ['imported', 'respondus'],
    };
  }
  if (correctIds.length === 1) {
    warnings.push({
      code: 'RESPONDUS_MULTIPLE_ANSWER_SINGLE_KEY',
      message: 'The multiple-answer question identifies only one correct choice.',
      path: href,
    });
  }
  return {
    type: 'multi_select',
    title,
    bodyHtml: toBodyHtml(question.prompt),
    choices,
    correctIds,
    minChoices: correctIds.length > 0 ? 1 : 0,
    maxChoices: choices.length,
    shuffle: false,
    tags: ['imported', 'respondus'],
  };
}

function buildFillBlankUnlabeledImportDraft(
  question: RespondusParsedQuestion,
  title: string,
  href: string,
  warnings: ImportWarning[],
): UnlabeledImportDraft {
  const inlineAnswers = question.choices.map((choice) => choice.text.trim()).filter(Boolean);
  const appendixAnswers = question.appendixAnswers.map((entry) => entry.value.trim()).filter(
    Boolean,
  );
  const answers = resolveAnswerForms(inlineAnswers, appendixAnswers, href, warnings);
  if (!answers.length) {
    warnings.push({
      code: 'MISSING_CORRECT',
      message: 'The fill-in-the-blank question does not provide an accepted answer.',
      path: href,
    });
  }
  const responseBaseType = answers.length > 0 && answers.every(isFiniteNumericText)
    ? 'float' as const
    : 'string' as const;
  const placeholder = createPlaceholderHtml({
    id: 'RESPONSE',
    label: 'Answer',
    widthClass: 'qti-input-width-10',
  });
  return {
    type: 'text_entry',
    title,
    bodyHtml: `${toBodyHtml(question.prompt)}<p>${placeholder}</p>`,
    textEntries: [{
      id: 'RESPONSE',
      label: 'Answer',
      responseBaseType,
      answers: answers.map((value, index) => ({
        id: `ANSWER_${index + 1}`,
        value,
        score: 1,
        caseSensitive: false,
      })),
    }],
    tags: ['imported', 'respondus'],
  };
}

function buildEssayUnlabeledImportDraft(
  question: RespondusParsedQuestion,
  title: string,
  href: string,
  warnings: ImportWarning[],
): UnlabeledImportDraft {
  const inlineAnswers = question.choices.map((choice) => choice.text.trim()).filter(Boolean);
  const appendixAnswers = question.appendixAnswers.map((entry) => entry.value.trim()).filter(
    Boolean,
  );
  const answers = resolveAnswerForms(inlineAnswers, appendixAnswers, href, warnings);
  if (answers.length > 1) {
    warnings.push({
      code: 'RESPONDUS_ESSAY_ANSWER_MULTIPLE',
      message: 'The essay question provides more than one model answer.',
      path: href,
    });
  }
  return {
    type: 'extended_text',
    title,
    bodyHtml: toBodyHtml(question.prompt),
    responseIdentifier: 'RESPONSE',
    expectedLength: 500,
    expectedLines: 15,
    minStrings: 1,
    maxStrings: 1,
    format: 'plain',
    responseBaseType: 'string',
    responseCardinality: 'single',
    heightClass: 'qti-height-lines-15',
    counterType: 'none',
    rubricHtml: answers[0] ? toBodyHtml(answers[0]) : '',
    tags: ['imported', 'respondus'],
  };
}

function buildMatchingUnlabeledImportDraft(
  question: RespondusParsedQuestion,
  title: string,
  href: string,
  warnings: ImportWarning[],
): UnlabeledImportDraft {
  const pairs = question.choices.flatMap((choice, index) => {
    const separator = choice.text.indexOf('=');
    if (
      separator < 1 ||
      separator !== choice.text.lastIndexOf('=') ||
      !choice.text.slice(separator + 1).trim()
    ) {
      warnings.push({
        code: 'INCOMPLETE_MATCH',
        message: `Matching choice ${choice.label} must contain one non-empty "=" pair.`,
        path: href,
      });
      return [];
    }
    return [{
      sourceId: choice.label,
      sourceText: choice.text.slice(0, separator).trim(),
      targetId: `TARGET_${index + 1}`,
      targetText: choice.text.slice(separator + 1).trim(),
    }];
  });
  if (pairs.length !== question.choices.length || pairs.length === 0) {
    warnings.push({
      code: 'INCOMPLETE_MATCH',
      message: 'The matching question could not recover every source pair.',
      path: href,
    });
  }
  if (question.appendixAnswers.length) {
    warnings.push({
      code: 'RESPONDUS_MATCH_ANSWER_LIST_IGNORED',
      message: 'Matching questions define pairs inline; their Answers entry was not applied.',
      path: href,
    });
  }
  return {
    type: 'match',
    title,
    bodyHtml: toBodyHtml(question.prompt),
    sources: pairs.map((pair) => ({
      id: pair.sourceId,
      text: pair.sourceText,
      matchMax: 1,
    })),
    targets: pairs.map((pair) => ({
      id: pair.targetId,
      text: pair.targetText,
      matchMax: 1,
    })),
    correctPairs: pairs.map((pair) => ({
      sourceId: pair.sourceId,
      targetId: pair.targetId,
    })),
    maxAssociations: pairs.length,
    shuffle: false,
    tags: ['imported', 'respondus'],
  };
}

function resolveChoiceKeys(
  question: RespondusParsedQuestion,
  cardinality: 'single' | 'multiple',
  href: string,
  warnings: ImportWarning[],
): string[] {
  const inline = question.choices.filter((choice) => choice.markedCorrect).map((choice) =>
    choice.label
  );
  const external = parseExternalChoiceKeys(question, cardinality, href, warnings);
  const resolved = resolveAnswerForms(inline, external, href, warnings);
  const available = new Set(question.choices.map((choice) => choice.label));
  if (resolved.some((key) => !available.has(key))) {
    warnings.push({
      code: 'INVALID_ANSWER_REFERENCE',
      message: 'The Respondus answer key references a choice that does not exist.',
      path: href,
    });
    return [];
  }
  if (!resolved.length) {
    warnings.push({
      code: 'MISSING_CORRECT',
      message: 'No correct answer was supplied; QFlowLearn did not default the answer to choice A.',
      path: href,
    });
    return [];
  }
  if (cardinality === 'single' && resolved.length !== 1) {
    warnings.push({
      code: 'RESPONDUS_SINGLE_ANSWER_MULTIPLE_KEYS',
      message: 'A single-answer question identifies more than one correct choice.',
      path: href,
    });
    return [];
  }
  return resolved;
}

function parseExternalChoiceKeys(
  question: RespondusParsedQuestion,
  cardinality: 'single' | 'multiple',
  href: string,
  warnings: ImportWarning[],
): string[] {
  if (!question.appendixAnswers.length) return [];
  const trueFalseLabels = trueFalseLabelsForChoices(question.choices);
  const rawTokens = question.appendixAnswers.flatMap((entry) =>
    cardinality === 'multiple' ? entry.value.split(/[\s,]+/).filter(Boolean) : [entry.value.trim()]
  );
  const keys = rawTokens.map((token) => {
    const normalized = token.trim().toUpperCase();
    if (trueFalseLabels) {
      if (normalized === 'TRUE' || normalized === 'T') return trueFalseLabels.trueLabel;
      if (normalized === 'FALSE' || normalized === 'F') return trueFalseLabels.falseLabel;
    }
    return normalized;
  });
  if (
    keys.some((key) => !/^[A-T]$/.test(key)) ||
    (cardinality === 'single' && keys.length !== 1)
  ) {
    warnings.push({
      code: 'INVALID_ANSWER_REFERENCE',
      message: 'The terminal Respondus answer key is not valid for this choice question.',
      path: href,
    });
    return [];
  }
  return uniqueNormalized(keys);
}

function resolveAnswerForms(
  inline: readonly string[],
  appendix: readonly string[],
  href: string,
  warnings: ImportWarning[],
): string[] {
  const normalizedInline = uniqueNormalized(inline);
  const normalizedAppendix = uniqueNormalized(appendix);
  if (
    normalizedInline.length &&
    normalizedAppendix.length &&
    !sameAnswerSet(normalizedInline, normalizedAppendix)
  ) {
    warnings.push({
      code: 'RESPONDUS_INLINE_APPENDIX_ANSWER_CONFLICT',
      message: 'Inline answers conflict with the terminal Respondus Answers section.',
      path: href,
    });
    return [];
  }
  return normalizedInline.length ? normalizedInline : normalizedAppendix;
}

function trueFalseLabelsForChoices(
  choices: readonly RespondusParsedChoice[],
): { readonly trueLabel: string; readonly falseLabel: string } | null {
  if (choices.length !== 2) return null;
  let trueLabel: string | null = null;
  let falseLabel: string | null = null;
  for (const choice of choices) {
    const text = choice.text.trim();
    if (/^(TRUE|T)$/i.test(text)) {
      if (trueLabel !== null) return null;
      trueLabel = choice.label;
      continue;
    }
    if (/^(FALSE|F)$/i.test(text)) {
      if (falseLabel !== null) return null;
      falseLabel = choice.label;
      continue;
    }
    return null;
  }
  return trueLabel !== null && falseLabel !== null ? { trueLabel, falseLabel } : null;
}

function isFiniteNumericText(value: string): boolean {
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) return false;
  return Number.isFinite(Number(value));
}

function uniqueNormalized(values: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

function sameAnswerSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightKeys = new Set(right.map((value) => value.toLocaleLowerCase()));
  return left.every((value) => rightKeys.has(value.toLocaleLowerCase()));
}

function defaultTitle(prompt: string, questionNumber: number): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 120) : `Question ${questionNumber}`;
}

function toBodyHtml(text: string): string {
  return sanitizeBodyHtml(`<p>${xmlEscape(text.trim())}</p>`) || '<p></p>';
}

function appendRespondusSourceFeatureWarnings(
  question: RespondusParsedQuestion,
  href: string,
  warnings: ImportWarning[],
): void {
  if (question.points !== null) {
    warnings.push({
      code: 'RESPONDUS_POINTS_NOT_MAPPED',
      message: `Respondus assigns ${question.points} point${
        question.points === 1 ? '' : 's'
      }; QFlowLearn does not yet map per-question points.`,
      path: href,
    });
  }
  if (
    question.correctFeedback ||
    question.incorrectFeedback ||
    question.choices.some((choice) => choice.feedback)
  ) {
    warnings.push({
      code: 'RESPONDUS_FEEDBACK_NOT_MAPPED',
      message:
        'Respondus feedback was detected and remains in the source evidence, but is not mapped into the QFlowLearn draft.',
      path: href,
    });
  }
  const sourceText = [
    question.prompt,
    ...question.choices.map((choice) => choice.text),
  ].join('\n');
  if (/\[HTML\]|\[\/HTML\]/i.test(sourceText)) {
    warnings.push({
      code: 'RESPONDUS_HTML_PRESERVED_AS_TEXT',
      message: 'Respondus HTML markers were preserved as text and require review.',
      path: href,
    });
  }
  if (/\[\s*img\s*:/i.test(sourceText) || /\[embedded image:/i.test(sourceText)) {
    warnings.push({
      code: 'RESPONDUS_IMAGE_REQUIRES_ASSET',
      message: 'A Respondus image reference was detected without an importable sidecar asset.',
      path: href,
    });
  }
}

function collectRespondusEvidence(
  question: RespondusParsedQuestion,
): ImportedSourceEvidence[] {
  const refs = [
    question.evidence,
    ...question.choices.map((choice) => choice.evidence),
    ...question.appendixAnswers.map((entry) => entry.evidence),
  ];
  const seen = new Set<string>();
  return refs.flatMap((entry) => {
    const key = `${entry.blockId}:${entry.quote}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ kind: 'block' as const, blockId: entry.blockId, quote: entry.quote }];
  });
}
