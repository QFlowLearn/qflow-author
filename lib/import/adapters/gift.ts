import {
  giftBodyHtml,
  giftChoiceContent,
  type GiftContentFormat,
  giftContentFragment,
  readGiftFormat,
} from './gift_content.ts';
import { importStandaloneHtml } from './standalone_html.ts';
import { parseGiftTrueFalse } from './gift_true_false.ts';
import { parseGiftNumerical } from './gift_numerical.ts';
import { findUnescaped, tokenizeAnswers, unescapeGift } from './gift_tokens.ts';
import { organizationGroupsFromParts } from '../organization_groups.ts';
import { categoryParts } from '../category_parts.ts';
import { sanitizeBodyHtml } from '../../sanitize.ts';
import { createPlaceholderHtml } from '../../text_entry_placeholders.ts';
import { createInlineChoiceMarkerHtml, type InlineChoiceSlot } from '../../types/inline_choice.ts';
import type { UnlabeledImportDraft } from '../imported_item_qti.ts';
import type { TextEntrySlot } from '../../types/text_entry.ts';
import { normalizeQtiIdentifier } from '../../qti_identifiers.ts';
import { IMPORT_ADAPTER_DESCRIPTORS } from '../adapter_descriptors.ts';
import { buildImportedItem } from '../imported_item_qti.ts';
import type {
  ImportAdapter,
  ImportedItem,
  ImportedPlacement,
  ImportResult,
  ImportSource,
  ImportWarning,
  SniffResult,
} from '../types.ts';

export const giftAdapter: ImportAdapter = {
  ...IMPORT_ADAPTER_DESCRIPTORS.gift,
  sniff: sniffGift,
  parse: parseGift,
};

const ZIP_MAGIC = [0x50, 0x4b];

function sniffGift(source: ImportSource): Promise<SniffResult> {
  const filename = String(source.filename ?? '').toLowerCase();
  const mime = String(source.mime ?? '').toLowerCase();
  const isZipByFilename = filename.endsWith('.zip');
  const isZipByMime = mime.includes('zip');
  const isZipByMagic = source.bytes.length >= 2 &&
    source.bytes[0] === ZIP_MAGIC[0] &&
    source.bytes[1] === ZIP_MAGIC[1];
  if (isZipByFilename || isZipByMime || isZipByMagic) {
    return Promise.resolve({ supported: false, confidence: 0, reason: 'zip-input' });
  }

  const preview = new TextDecoder().decode(source.bytes.slice(0, 4096));
  const hasEssay = extractAnswerBlocks(preview).answerBlocks.some((block) =>
    block.content.trim() === '' || block.content.trim().startsWith('####')
  );
  if (
    hasEssay || /(^|\n)::[^\n]+::/.test(preview) || /\{[^}]*[=~#]/.test(preview) ||
    /\{(true|false|t|f)\}/i.test(preview)
  ) {
    return Promise.resolve({ supported: true, confidence: 0.5, reason: 'gift-markers' });
  }
  return Promise.resolve({ supported: false, confidence: 0, reason: 'no-gift-markers' });
}

function parseGift(source: ImportSource): Promise<ImportResult> {
  const text = new TextDecoder().decode(source.bytes);
  const blocks = splitGiftBlocks(text);
  const warnings: ImportWarning[] = [];
  const items: ImportedItem[] = [];
  const categorized: { category: string | null; placement: ImportedPlacement }[] = [];
  const usedIds = new Set<string>();
  let currentCategory: string | null = null;

  blocks.forEach((block, index) => {
    const trimmed = block.trim();
    if (!trimmed) return;
    const categoryMatch = /^\$CATEGORY:\s*(.*)$/i.exec(trimmed);
    if (categoryMatch) {
      currentCategory = categoryMatch[1].trim() || null;
      return;
    }

    const { title, content: rawContent } = extractTitle(trimmed);
    const questionWarnings: ImportWarning[] = [];
    const { content, format } = readGiftFormat(rawContent, questionWarnings);
    const { answerBlocks } = extractAnswerBlocks(content);
    const identifier = uniqueIdentifier(
      normalizeQtiIdentifier(title || `ITEM_${index + 1}`),
      usedIds,
    );
    const tags = currentCategory ? [normalizeCategoryTag(currentCategory)] : undefined;
    if (answerBlocks.length === 0) {
      const passage = importStandaloneHtml(giftBodyHtml(content, format), `${identifier}.xml`);
      for (const content of passage.content) {
        categorized.push({ category: currentCategory, placement: { content } });
      }
      questionWarnings.push({
        code: 'LMS_CONTENT_REVIEW',
        message: `Description "${
          title || identifier
        }" is retained as ordered unscored text and images. Formatting is simplified. ${
          passage.omissions.join(' ')
        }`,
      });
      warnings.push(
        ...questionWarnings.map((warning) => ({ ...warning, path: `${identifier}.xml` })),
      );
      return;
    }

    let draft: UnlabeledImportDraft | null = null;
    const isCloze = answerBlocks.length > 1 ||
      (answerBlocks.length === 1 && content.slice(answerBlocks[0].end + 1).trim().length > 0);
    if (isCloze) {
      draft = buildCloze(content, answerBlocks, questionWarnings, format, tags, title);
    } else {
      const questionText = content.slice(0, answerBlocks[0].start).trim();
      draft = buildSimpleQuestion(
        questionText,
        answerBlocks[0],
        questionWarnings,
        format,
        tags,
        title,
      );
    }

    if (!draft) {
      warnings.push(...questionWarnings);
      return;
    }
    const finalTitle = (draft.title as string) || title || `Question ${index + 1}`;
    const item = buildImportedItem({
      sourceFormat: 'gift',
      sourceEvidence: questionWarnings.filter((warning) =>
        warning.code === 'GIFT_FEEDBACK_IGNORED' && warning.detail
      ).map((warning, index) => ({
        kind: 'block',
        blockId: `gift-feedback-${index + 1}`,
        quote: warning.detail ?? '',
      })),
      draft,
      identifier,
      title: finalTitle,
      sourceText: content,
      href: `${identifier}.xml`,
    });
    warnings.push(...questionWarnings.map((warning) => ({ ...warning, path: item.href })));
    items.push(item);
    categorized.push({ category: currentCategory, placement: { href: item.href } });
  });

  if (!items.length && !categorized.length) {
    throw new Error('No GIFT questions found');
  }

  return categoryParts(categorized).then((parts) => ({
    title: 'Imported GIFT Quiz',
    parts,
    organizationGroups: organizationGroupsFromParts(parts),
    items,
    assets: [],
    warnings: warnings.length ? warnings : undefined,
  }));
}

function buildSimpleQuestion(
  questionText: string,
  answerBlock: AnswerBlock,
  warnings: ImportWarning[],
  format: GiftContentFormat,
  tags?: string[],
  title?: string,
): UnlabeledImportDraft | null {
  const bodyHtml = giftBodyHtml(questionText, format);
  const parsed = parseAnswerBlock(answerBlock.content, warnings);
  if (!parsed) return null;

  if (parsed.kind === 'truefalse') {
    return {
      type: 'single_select',
      title: title || 'True/False',
      bodyHtml,
      choices: [
        { id: 'TRUE', text: 'True' },
        { id: 'FALSE', text: 'False' },
      ],
      correctId: parsed.correct ? 'TRUE' : 'FALSE',
      shuffle: false,
      tags,
    };
  }

  if (parsed.kind === 'essay') {
    return {
      type: 'extended_text',
      externalScored: 'human',
      title: title || 'Essay',
      bodyHtml,
      responseIdentifier: 'RESPONSE',
      responseBaseType: 'string',
      responseCardinality: 'single',
      format: 'plain',
      heightClass: 'qti-height-lines-6',
      counterType: 'none',
      tags,
    };
  }

  if (parsed.kind === 'numerical') {
    const textEntries: TextEntrySlot[] = [
      {
        id: 'RESPONSE',
        label: 'Answer',
        responseBaseType: 'float',
        answers: parsed.answers.map((ans) => ({
          id: crypto.randomUUID(),
          value: ans.text,
          score: ans.score,
          caseSensitive: true,
        })),
      },
    ];
    return {
      type: 'text_entry',
      title: title || 'Numerical',
      bodyHtml: appendPlaceholder(
        bodyHtml,
        createPlaceholderHtml({ id: 'RESPONSE', label: 'Answer' }),
      ),
      textEntries,
      tags,
    };
  }

  if (parsed.kind === 'matching') {
    return {
      type: 'match',
      title: title || 'Matching',
      bodyHtml,
      sources: parsed.sources.map((source) => ({
        ...source,
        ...giftChoiceContent(source.text ?? '', format, warnings),
      })),
      targets: parsed.targets.map((target) => ({
        ...target,
        ...giftChoiceContent(target.text ?? '', format, warnings),
      })),
      correctPairs: parsed.correctPairs,
      tags,
    };
  }

  if (parsed.kind === 'shortanswer') {
    const textEntries: TextEntrySlot[] = [
      {
        id: 'RESPONSE',
        label: 'Answer',
        responseBaseType: 'string',
        answers: parsed.answers.map((ans) => ({
          id: crypto.randomUUID(),
          value: ans.text,
          score: ans.score,
          caseSensitive: false,
        })),
      },
    ];
    return {
      type: 'text_entry',
      title: title || 'Short Answer',
      bodyHtml: appendPlaceholder(
        bodyHtml,
        createPlaceholderHtml({ id: 'RESPONSE', label: 'Answer' }),
      ),
      textEntries,
      tags,
    };
  }

  const choices = parsed.answers.map((ans, idx) => ({
    id: choiceLabel(idx),
    ...giftChoiceContent(ans.text, format, warnings),
  }));
  const scores = parsed.answers.map((answer) => answer.score);
  const positive = scores.filter((score) => score > 0);
  const hasPartial = scores.some((score) => score !== 0 && score !== 1);
  const representable = parsed.kind === 'multiselect'
    ? positive.length > 0 && scores.every((score) => score >= 0) &&
      positive.every((score) => Math.abs(score - 1 / positive.length) < 0.000001)
    : positive.length === 1 && positive[0] === 1 &&
      scores.every((score) => score === 0 || score === 1);
  if (!representable) {
    warnings.push({
      code: 'LMS_SCORING_REVIEW',
      message: `Source GIFT choice weights (${
        scores.join(', ')
      }) require explicit scoring reconstruction before acceptance.`,
    });
  }

  const correctIds = choices
    .filter((_choice, idx) => parsed.answers[idx]?.score > 0)
    .map((choice) => choice.id);

  if (parsed.kind === 'multiselect') {
    if (!correctIds.length && choices[0]) correctIds.push(choices[0].id);
    return {
      type: 'multi_select',
      maximumScore: 1,
      responseMode: hasPartial ? 'partial' : 'all_or_nothing',
      title: title || 'Multi Select',
      bodyHtml,
      choices,
      correctIds,
      shuffle: true,
      tags,
    };
  }

  const correctId = correctIds[0] ?? choices[0]?.id ?? '';
  return {
    type: 'single_select',
    title: title || 'Single Select',
    bodyHtml,
    choices,
    correctId,
    shuffle: true,
    tags,
  };
}

function buildCloze(
  fullText: string,
  answerBlocks: AnswerBlock[],
  warnings: ImportWarning[],
  format: GiftContentFormat,
  tags?: string[],
  title?: string,
): UnlabeledImportDraft {
  let idx = 1;
  const inlineSlots: InlineChoiceSlot[] = [];
  const textSlots: TextEntrySlot[] = [];

  let html = '';
  let cursor = 0;
  for (const block of answerBlocks) {
    html += giftContentFragment(fullText.slice(cursor, block.start), format);
    cursor = block.end + 1;
    const parsed = parseClozeAnswer(block.content, warnings);
    if (!parsed) continue;
    const id = `RESPONSE_${idx++}`;
    const label = `Blank ${idx - 1}`;

    if (parsed.kind === 'inline_choice') {
      const options = parsed.answers.map((ans, optionIdx) => ({
        id: choiceLabel(optionIdx),
        ...giftChoiceContent(ans.text, format, warnings),
        score: ans.score,
      }));
      const best = options.reduce(
        (bestIdx, opt, optionIdx) =>
          (opt.score ?? 0) > (options[bestIdx]?.score ?? 0) ? optionIdx : bestIdx,
        0,
      );
      inlineSlots.push({
        id,
        label,
        required: true,
        shuffle: false,
        options,
        correctId: options[best]?.id,
      });
      html += createInlineChoiceMarkerHtml({ id, label });
    } else {
      textSlots.push({
        id,
        label,
        responseBaseType: parsed.baseType,
        answers: parsed.answers.map((ans) => ({
          id: crypto.randomUUID(),
          value: ans.text,
          score: ans.score,
          caseSensitive: parsed.caseSensitive,
        })),
      });
      html += createPlaceholderHtml({ id, label });
    }
  }
  html += giftContentFragment(fullText.slice(cursor), format);
  const bodyHtml = sanitizeBodyHtml(wrapParagraph(html)) || '<p></p>';

  if (inlineSlots.length && textSlots.length) {
    warnings.push({
      code: 'GIFT_CLOZE_MIXED',
      message: 'Cloze mixes choice and short answer. Imported as text entry.',
      detail: title,
    });
    const mergedSlots: TextEntrySlot[] = [
      ...textSlots,
      ...inlineSlots.map((slot): TextEntrySlot => ({
        id: slot.id,
        label: slot.label,
        responseBaseType: 'string',
        answers: slot.options.map((opt) => ({
          id: crypto.randomUUID(),
          value: opt.text ?? opt.id,
          score: opt.score ?? (opt.id === slot.correctId ? 1 : 0),
          caseSensitive: false,
        })),
      })),
    ];
    return {
      type: 'text_entry',
      title: title || 'Cloze',
      bodyHtml,
      textEntries: mergedSlots,
      tags,
    };
  }

  if (inlineSlots.length) {
    return {
      type: 'inline_choice',
      title: title || 'Cloze',
      bodyHtml,
      inlineChoices: inlineSlots,
      responseMode:
        inlineSlots.some((slot) =>
            slot.options.some((opt) => opt.score != null && opt.score !== 0 && opt.score !== 1)
          )
          ? 'partial'
          : 'all_or_nothing',
      tags,
    };
  }

  return {
    type: 'text_entry',
    title: title || 'Cloze',
    bodyHtml,
    textEntries: textSlots,
    tags,
  };
}

type AnswerBlock = { start: number; end: number; content: string };

function extractTitle(text: string): { title: string; content: string } {
  if (!text.startsWith('::')) return { title: '', content: text };
  const end = text.indexOf('::', 2);
  if (end === -1) return { title: '', content: text };
  return {
    title: unescapeGift(text.slice(2, end).trim()),
    content: text.slice(end + 2).trim(),
  };
}

function extractAnswerBlocks(text: string): { answerBlocks: AnswerBlock[] } {
  const blocks: AnswerBlock[] = [];
  let depth = 0;
  let start = -1;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        blocks.push({ start, end: i, content: text.slice(start + 1, i) });
        start = -1;
      }
    }
  }
  return { answerBlocks: blocks };
}

type ParsedAnswer =
  | {
    kind: 'truefalse';
    correct: boolean;
  }
  | {
    kind: 'essay';
  }
  | {
    kind: 'numerical' | 'shortanswer' | 'single' | 'multiselect';
    answers: Array<{ text: string; score: number }>;
  }
  | {
    kind: 'matching';
    sources: Array<{ id: string; text?: string; html?: string }>;
    targets: Array<{ id: string; text?: string; html?: string }>;
    correctPairs: Array<{ sourceId: string; targetId: string }>;
  };

function parseAnswerBlock(content: string, warnings: ImportWarning[]): ParsedAnswer | null {
  const generalIndex = findUnescaped(content, '####');
  if (generalIndex >= 0) {
    warnings.push({
      code: 'GIFT_FEEDBACK_IGNORED',
      message:
        'General feedback is retained in the source review evidence; configure its delivery behavior explicitly.',
      detail: unescapeGift(content.slice(generalIndex + 4).trim()),
    });
  }
  const trimmed = (generalIndex >= 0 ? content.slice(0, generalIndex) : content).trim();
  if (!trimmed) return { kind: 'essay' };
  const trueFalse = parseGiftTrueFalse(trimmed, warnings);
  if (trueFalse !== null) return { kind: 'truefalse', correct: trueFalse };
  if (trimmed.startsWith('#')) {
    return { kind: 'numerical', answers: parseGiftNumerical(trimmed.slice(1), warnings) };
  }

  const tokens = tokenizeAnswers(trimmed);
  if (!tokens.length) return null;

  if (tokens.some((t) => t.text.includes('->'))) {
    const sources: Array<{ id: string; text?: string; html?: string }> = [];
    const targets: Array<{ id: string; text?: string; html?: string }> = [];
    const correctPairs: Array<{ sourceId: string; targetId: string }> = [];
    const targetMap = new Map<string, string>();
    tokens.forEach((token, idx) => {
      const parts = token.text.split('->').map((part) => part.trim()).filter(Boolean);
      if (parts.length < 2) return;
      const sourceId = `S${idx + 1}`;
      sources.push({ id: sourceId, text: unescapeGift(parts[0]) });
      const targetText = unescapeGift(parts[1]);
      let targetId = targetMap.get(targetText);
      if (!targetId) {
        targetId = `T${targetMap.size + 1}`;
        targetMap.set(targetText, targetId);
        targets.push({ id: targetId, text: targetText });
      }
      correctPairs.push({ sourceId, targetId });
    });
    return { kind: 'matching', sources, targets, correctPairs };
  }

  const answers = tokens.map((token) => ({
    text: unescapeGift(token.text),
    score: token.score,
  }));
  const correctCount = answers.filter((ans) => ans.score > 0).length;
  if (tokens.some((t) => t.feedback)) {
    warnings.push({
      code: 'GIFT_FEEDBACK_IGNORED',
      message: 'Answer feedback ignored.',
    });
  }
  if (tokens.some((t) => t.marker === '~')) {
    return {
      kind: tokens.every((t) => t.marker === '~') || correctCount > 1 ? 'multiselect' : 'single',
      answers,
    };
  }
  return { kind: 'shortanswer', answers };
}

function parseClozeAnswer(content: string, warnings: ImportWarning[]): {
  kind: 'inline_choice' | 'text_entry';
  baseType: 'string' | 'float';
  caseSensitive: boolean;
  answers: Array<{ text: string; score: number }>;
} | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  let typeToken = '';
  let answerPart = trimmed;
  const firstColon = trimmed.indexOf(':');
  if (firstColon >= 0) {
    const head = trimmed.slice(0, firstColon).trim();
    const rest = trimmed.slice(firstColon + 1);
    if (isNumeric(head)) {
      const secondColon = rest.indexOf(':');
      if (secondColon >= 0) {
        typeToken = rest.slice(0, secondColon).trim();
        answerPart = rest.slice(secondColon + 1);
      } else {
        answerPart = rest;
      }
    } else {
      typeToken = head;
      answerPart = rest;
    }
  }

  const typeUpper = typeToken.toUpperCase();
  const isMulti = typeUpper.includes('MULTICHOICE') || typeUpper.includes('MULTIRESPONSE') ||
    typeUpper.includes('MC');
  const isNumericType = typeUpper.includes('NUMERICAL');
  const caseSensitive = typeUpper.includes('SHORTANSWER_C');
  const answers = parseAnswerBlock(answerPart, warnings);
  if (!answers || !('answers' in answers)) return null;

  if (isMulti) {
    return {
      kind: 'inline_choice',
      baseType: 'string',
      caseSensitive: false,
      answers: answers.answers,
    };
  }

  return {
    kind: 'text_entry',
    baseType: isNumericType ? 'float' : 'string',
    caseSensitive,
    answers: answers.answers,
  };
}

function splitGiftBlocks(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let buffer: string[] = [];
  let depth = 0;
  for (const line of lines) {
    if (line.trim().startsWith('//')) continue;
    // A category directive is its own block, even without surrounding blank lines.
    if (depth === 0 && /^\s*\$CATEGORY:/i.test(line)) {
      const question = buffer.join('\n').trim();
      if (question) blocks.push(question);
      blocks.push(line.trim());
      buffer = [];
      continue;
    }
    buffer.push(line);
    depth += countUnescaped(line, '{') - countUnescaped(line, '}');
    if (line.trim() === '' && depth <= 0) {
      const block = buffer.join('\n').trim();
      if (block) blocks.push(block);
      buffer = [];
    }
  }
  const last = buffer.join('\n').trim();
  if (last) blocks.push(last);
  return blocks;
}

function countUnescaped(text: string, token: string): number {
  let count = 0;
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === token) count += 1;
  }
  return count;
}

function choiceLabel(index: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (index < alphabet.length) return alphabet[index];
  return `C${index + 1}`;
}

function uniqueIdentifier(base: string, seen: Set<string>): string {
  let id = base;
  let counter = 1;
  while (seen.has(id)) {
    counter += 1;
    id = `${base}_${counter}`;
  }
  seen.add(id);
  return id;
}

function normalizeCategoryTag(value: string): string {
  const trimmed = value.replace(/\$course\$\//gi, '').trim();
  const last = trimmed.split('/').filter(Boolean).pop() ?? trimmed;
  return last || trimmed;
}

function wrapParagraph(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return '<p></p>';
  if (trimmed.startsWith('<p')) return trimmed;
  return `<p>${trimmed}</p>`;
}

function appendPlaceholder(bodyHtml: string, placeholder: string): string {
  const clean = sanitizeBodyHtml(bodyHtml || '');
  if (!clean || clean === '<p></p>') return `<p>${placeholder}</p>`;
  return `${clean}\n<p>${placeholder}</p>`;
}

function isNumeric(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test((value ?? '').trim());
}
