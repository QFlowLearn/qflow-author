import { sanitizeBodyHtml } from '../../sanitize.ts';
import { createPlaceholderHtml } from '../../text_entry_placeholders.ts';
import type { UnlabeledImportDraft } from '../imported_item_qti.ts';
import { xmlEscape } from '../../xml.ts';
import { buildImportedItem } from '../imported_item_qti.ts';
import type { ImportedItem, ImportWarning } from '../types.ts';
import type {
  ExamViewParsedEntry,
  ExamViewParsedMatchingGroup,
  ExamViewParsedQuestion,
} from './examview_xml_parser.ts';

type CompleteUnlabeledImportDraft = UnlabeledImportDraft & {
  type: NonNullable<UnlabeledImportDraft['type']>;
};

const DECIMAL_ANSWER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** One imported ExamView item and every review diagnostic produced while mapping it. */
export type ExamViewBuiltItem = {
  readonly item: ImportedItem;
  readonly warnings: readonly ImportWarning[];
};

/** Map one parsed ExamView XML entry into the canonical QFlow draft model. */
export function buildExamViewImportedItem(
  entry: ExamViewParsedEntry,
  identifier: string,
  href: string,
): ExamViewBuiltItem {
  const warnings: ImportWarning[] = [];
  const diagnostics = entry._tag === 'question'
    ? entry.question.diagnostics
    : entry.group.diagnostics;
  warnings.push(...diagnostics.map((diagnostic) => ({ ...diagnostic, path: href })));
  const draft = entry._tag === 'question'
    ? draftForQuestion(entry.question, href, warnings)
    : draftForMatchingGroup(entry.group, href, warnings);
  const title = draft.title ?? 'Imported ExamView question';
  const prompt = entry._tag === 'question' ? entry.question.prompt : entry.group.prompt;
  const item = buildImportedItem({
    sourceFormat: 'examview',
    draft,
    identifier,
    title,
    sourceText: prompt,
    href,
    sourceEvidence: [{
      kind: 'block',
      blockId: entry._tag === 'question'
        ? entry.question.evidence.blockId
        : entry.group.evidence.blockId,
      quote: entry._tag === 'question' ? entry.question.evidence.quote : entry.group.evidence.quote,
    }],
  });
  return {
    item,
    warnings,
  };
}

function draftForQuestion(
  question: ExamViewParsedQuestion,
  href: string,
  warnings: ImportWarning[],
): CompleteUnlabeledImportDraft {
  const title = defaultTitle(question.prompt, question.sequence);
  if (!question.prompt) {
    warnings.push({
      code: 'EXAMVIEW_QUESTION_TEXT_MISSING',
      message: 'The ExamView question does not include question text.',
      path: href,
    });
  }
  switch (question.kind) {
    case 'true_false':
      return buildFixedChoiceUnlabeledImportDraft(
        question,
        title,
        href,
        warnings,
        [
          { id: 'T', text: 'True' },
          { id: 'F', text: 'False' },
        ],
      );
    case 'yes_no':
      return buildFixedChoiceUnlabeledImportDraft(
        question,
        title,
        href,
        warnings,
        [
          { id: 'Y', text: 'Yes' },
          { id: 'N', text: 'No' },
        ],
      );
    case 'choice':
      return buildChoiceUnlabeledImportDraft(question, title, href, warnings);
    case 'completion':
      return buildTextEntryUnlabeledImportDraft(question, title, href, warnings, 'string');
    case 'short_answer':
      return buildOpenResponseUnlabeledImportDraft(question, title);
    case 'numeric':
      return buildNumericUnlabeledImportDraft(question, title, href, warnings);
    case 'open_response':
      return buildOpenResponseUnlabeledImportDraft(question, title);
    case 'matching_member':
      warnings.push({
        code: 'UNSUPPORTED_ITEM_STUBBED',
        message: question.groupName
          ? `ExamView matching group "${question.groupName}" is missing its group definition.`
          : 'The ExamView matching question does not identify a matching group.',
        path: href,
      });
      return buildOpenResponseUnlabeledImportDraft(question, title, 'placeholder');
    case 'unknown':
      warnings.push({
        code: 'UNSUPPORTED_ITEM_STUBBED',
        message: `ExamView question type "${question.typeCode || 'missing'}" is not supported.`,
        path: href,
      });
      return buildOpenResponseUnlabeledImportDraft(question, title, 'placeholder');
  }
}

function buildFixedChoiceUnlabeledImportDraft(
  question: ExamViewParsedQuestion,
  title: string,
  href: string,
  warnings: ImportWarning[],
  choices: Array<{ id: string; text: string }>,
): CompleteUnlabeledImportDraft {
  const correctId = resolveSingleAnswer(
    question,
    choices.map((choice) => choice.id),
    href,
    warnings,
  );
  return {
    type: 'single_select',
    title,
    bodyHtml: toBodyHtml(question.prompt),
    choices,
    correctId,
    shuffle: false,
    tags: ['imported', 'examview'],
  };
}

function buildChoiceUnlabeledImportDraft(
  question: ExamViewParsedQuestion,
  title: string,
  href: string,
  warnings: ImportWarning[],
): CompleteUnlabeledImportDraft {
  const choiceKeys = question.choices.map((choice) => choice.key);
  if (
    question.choices.length < 2 ||
    new Set(choiceKeys).size !== choiceKeys.length ||
    question.choices.some((choice) => !choice.text)
  ) {
    warnings.push({
      code: 'EXAMVIEW_CHOICES_INCOMPLETE',
      message:
        'An ExamView multiple-choice question must include at least two non-empty, uniquely labeled choices.',
      path: href,
    });
  }
  const choices = question.choices.map((choice) => ({
    id: choice.key,
    text: choice.text,
  }));
  const correctId = resolveSingleAnswer(
    question,
    choices.map((choice) => choice.id),
    href,
    warnings,
  );
  return {
    type: 'single_select',
    title,
    bodyHtml: toBodyHtml(question.prompt),
    choices,
    correctId,
    shuffle: false,
    tags: ['imported', 'examview'],
  };
}

function buildTextEntryUnlabeledImportDraft(
  question: ExamViewParsedQuestion,
  title: string,
  href: string,
  warnings: ImportWarning[],
  responseBaseType: 'float' | 'string',
  reportMissingAnswer = true,
): CompleteUnlabeledImportDraft {
  if (reportMissingAnswer && question.answerLines.length === 0) {
    warnings.push({
      code: 'MISSING_CORRECT',
      message: 'The ExamView question does not provide an accepted answer.',
      path: href,
    });
  }
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
      answers: question.answerLines.map((value, index) => ({
        id: `ANSWER_${index + 1}`,
        value,
        score: 1,
        caseSensitive: false,
      })),
    }],
    tags: ['imported', 'examview'],
  };
}

function buildNumericUnlabeledImportDraft(
  question: ExamViewParsedQuestion,
  title: string,
  href: string,
  warnings: ImportWarning[],
): CompleteUnlabeledImportDraft {
  const unsupported = question.answerLines.some((answer) => !DECIMAL_ANSWER_PATTERN.test(answer));
  if (unsupported) {
    warnings.push({
      code: 'EXAMVIEW_NUMERIC_ANSWER_UNSUPPORTED',
      message:
        'ExamView numeric import supports integer and decimal answers only; this answer requires review.',
      path: href,
    });
  }
  return buildTextEntryUnlabeledImportDraft(
    {
      ...question,
      answerLines: unsupported ? [] : question.answerLines,
    },
    title,
    href,
    warnings,
    'float',
    !unsupported,
  );
}

function buildOpenResponseUnlabeledImportDraft(
  question: ExamViewParsedQuestion,
  title: string,
  mode: 'authored' | 'placeholder' = 'authored',
): CompleteUnlabeledImportDraft {
  return {
    type: 'extended_text',
    title,
    bodyHtml: toBodyHtml(question.prompt),
    responseIdentifier: 'RESPONSE',
    expectedLength: mode === 'authored' ? 500 : 200,
    expectedLines: mode === 'authored' ? 15 : 6,
    minStrings: 1,
    maxStrings: 1,
    format: 'plain',
    responseBaseType: 'string',
    responseCardinality: 'single',
    heightClass: mode === 'authored' ? 'qti-height-lines-15' : 'qti-height-lines-6',
    counterType: 'none',
    rubricHtml: question.answerLines.length > 0 ? toBodyHtml(question.answerLines.join('\n')) : '',
    tags: ['imported', 'examview'],
  };
}

function draftForMatchingGroup(
  group: ExamViewParsedMatchingGroup,
  href: string,
  warnings: ImportWarning[],
): CompleteUnlabeledImportDraft {
  const title = defaultTitle(group.prompt, group.sequence);
  const targetKeyToId = new Map(
    group.choices.map((choice, index) => [choice.key, `TARGET_${index + 1}`]),
  );
  const sources = group.members.map((member, index) => ({
    id: `SOURCE_${index + 1}`,
    text: member.prompt,
    matchMax: 1,
  }));
  const targets = group.choices.map((choice, index) => ({
    id: `TARGET_${index + 1}`,
    text: choice.text,
    matchMax: 1,
  }));
  const correctPairs = group.members.flatMap((member, index) => {
    if (member.answerLines.length !== 1) {
      warnings.push({
        code: 'INCOMPLETE_MATCH',
        message: `ExamView matching member "${
          member.prompt || member.sourceId
        }" must have one answer key.`,
        path: href,
      });
      return [];
    }
    const targetId = targetKeyToId.get(member.answerLines[0].toUpperCase());
    if (!targetId) {
      warnings.push({
        code: 'INCOMPLETE_MATCH',
        message: `ExamView matching member "${
          member.prompt || member.sourceId
        }" references a missing group choice.`,
        path: href,
      });
      return [];
    }
    return [{ sourceId: `SOURCE_${index + 1}`, targetId }];
  });
  const targetKeys = group.choices.map((choice) => choice.key);
  if (
    !group.prompt || sources.length === 0 || targets.length < 2 ||
    new Set(targetKeys).size !== targetKeys.length ||
    group.choices.some((choice) => !choice.text) ||
    correctPairs.length !== sources.length
  ) {
    warnings.push({
      code: 'INCOMPLETE_MATCH',
      message: 'The ExamView matching group could not recover every required source and pair.',
      path: href,
    });
  }
  return {
    type: 'match',
    title,
    bodyHtml: toBodyHtml(group.prompt),
    sources,
    targets,
    correctPairs,
    maxAssociations: sources.length,
    shuffle: false,
    tags: ['imported', 'examview'],
  };
}

function resolveSingleAnswer(
  question: ExamViewParsedQuestion,
  available: readonly string[],
  href: string,
  warnings: ImportWarning[],
): string {
  if (question.answerLines.length === 0) {
    warnings.push({
      code: 'MISSING_CORRECT',
      message: 'The ExamView question does not provide a correct answer.',
      path: href,
    });
    return '';
  }
  if (question.answerLines.length !== 1) {
    warnings.push({
      code: 'EXAMVIEW_SINGLE_ANSWER_MULTIPLE_KEYS',
      message: 'The ExamView single-answer question provides more than one answer key.',
      path: href,
    });
    return '';
  }
  const key = question.answerLines[0].toUpperCase();
  if (!available.includes(key)) {
    warnings.push({
      code: 'INVALID_ANSWER_REFERENCE',
      message: 'The ExamView answer key references a choice that does not exist.',
      path: href,
    });
    return '';
  }
  return key;
}

function defaultTitle(prompt: string, sequence: number): string {
  const collapsed = prompt.replace(/\s+/g, ' ').trim();
  if (!collapsed) return `ExamView question ${sequence}`;
  return collapsed.length <= 100 ? collapsed : `${collapsed.slice(0, 97).trimEnd()}…`;
}

function toBodyHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '<p>Source question text is missing.</p>';
  return sanitizeBodyHtml(`<p>${xmlEscape(trimmed)}</p>`) ||
    '<p>Source question text is missing.</p>';
}
