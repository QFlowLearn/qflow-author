import type {
  ImportAdapter,
  ImportedPart,
  ImportResult,
  ImportSource,
  SniffResult,
} from '../types.ts';
import { IMPORT_ADAPTER_DESCRIPTORS } from '../adapter_descriptors.ts';
import { buildRespondusImportedItem } from './respondus_standard_drafts.ts';
import { classifyRespondusLine } from './respondus_standard_grammar.ts';
import { parseRespondusStandard } from './respondus_standard_parser.ts';
import {
  classifyRespondusSource,
  extractRespondusSource,
  respondusSourceLines,
} from './respondus_standard_source.ts';

/** Typed boundary error for a source that violates Respondus Standard Format. */
class RespondusStandardFormatError extends Error {
  readonly _tag = 'RespondusStandardFormatError' as const;

  constructor(message: string) {
    super(message);
    this.name = 'RespondusStandardFormatError';
  }
}

/** Deterministic Respondus Standard Format recovery adapter. */
export const respondusStandardAdapter: ImportAdapter = {
  ...IMPORT_ADAPTER_DESCRIPTORS.respondusStandard,
  sniff: sniffRespondusStandard,
  parse: parseRespondusSource,
};

async function sniffRespondusStandard(source: ImportSource): Promise<SniffResult> {
  if (classifyRespondusSource(source) === null) {
    return { supported: false, confidence: 0, reason: 'unsupported-container' };
  }
  let document;
  try {
    document = await extractRespondusSource(source);
  } catch (_cause: unknown) {
    return { supported: false, confidence: 0, reason: 'source-decode-failed' };
  }
  const lines = respondusSourceLines(document);
  const syntax = lines.map((line) => classifyRespondusLine(line.text));
  const questionCount = syntax.filter((line) => line._tag === 'question').length;
  const choiceCount = syntax.filter((line) => line._tag === 'choice').length;
  const typeCount =
    syntax.filter((line) => line._tag === 'type_directive' && line.code.length > 0).length;
  const answersCount = syntax.filter((line) => line._tag === 'answers_directive').length;
  const starredCount = syntax.filter((line) => line._tag === 'choice' && line.markedCorrect).length;
  if (questionCount === 0 || (choiceCount === 0 && typeCount === 0)) {
    return { supported: false, confidence: 0, reason: 'no-respondus-question-pattern' };
  }
  if (typeCount > 0) {
    return { supported: true, confidence: 0.98, reason: 'respondus-type-directive' };
  }
  if (answersCount === 1) {
    return { supported: true, confidence: 0.96, reason: 'respondus-terminal-answer-key' };
  }
  if (starredCount > 0) {
    return { supported: true, confidence: 0.94, reason: 'respondus-starred-answer' };
  }
  if (choiceCount >= 2) {
    return {
      supported: false,
      confidence: 0.66,
      reason: 'possible-respondus-numbered-choice-pattern',
    };
  }
  return { supported: false, confidence: 0, reason: 'incomplete-respondus-pattern' };
}

async function parseRespondusSource(source: ImportSource): Promise<ImportResult> {
  const normalizedSource = await extractRespondusSource(source);
  const parsed = parseRespondusStandard(respondusSourceLines(normalizedSource));
  if (parsed._tag === 'invalid') {
    const details = parsed.issues
      .map((issue) => `line ${issue.line}: ${issue.message}`)
      .join(' ');
    throw new RespondusStandardFormatError(`Invalid Respondus Standard Format. ${details}`);
  }

  const built = parsed.value.questions.map(buildRespondusImportedItem);
  const items = built.map((entry) => entry.item);
  const warnings = built.flatMap((entry) => entry.warnings);
  const sourceTitle = source.filename?.trim().replace(/\.(?:respondus|txt|docx)$/i, '').trim();
  const parts: ImportedPart[] = [{
    id: 'part-1',
    title: 'Part 1',
    placements: items.map((item) => ({ href: item.href })),
  }];
  return {
    title: sourceTitle || 'Imported Respondus assessment',
    parts,
    // A filename is a proposal only; organization requires an explicit source mapping.
    organizationGroups: sourceTitle && items.length > 0
      ? [{ id: 'respondus-file', title: sourceTitle, hrefs: items.map((item) => item.href) }]
      : [],
    items,
    assets: [],
    warnings: warnings.length ? warnings : undefined,
    normalizedSource,
  };
}
