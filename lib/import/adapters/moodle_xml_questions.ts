import { sanitizeBodyHtml, sanitizeInlineHtml } from '../../sanitize.ts';
import { createPlaceholderHtml } from '../../text_entry_placeholders.ts';
import type { UnlabeledImportDraft } from '../imported_item_qti.ts';
import { createGapMarkerHtml, type GapMatchChoice, type GapTarget } from '../../types/gap_match.ts';
import type { TextEntrySlot } from '../../types/text_entry.ts';
import { xmlEscape } from '../../xml.ts';
import {
  attr,
  findAllDescendantsByLocalName,
  findDescendantByLocalName,
  toNumber,
} from '../xml_dom.ts';
import type { ImportWarning } from '../types.ts';
import { moodleChoiceScoring } from './moodle_xml_scoring.ts';
import { parseMoodleCloze } from './moodle_xml_cloze.ts';
import {
  type MoodleAssetContext,
  moodleChoiceLabel,
  readMoodleBodyHtml,
  readMoodleInlineHtml,
  readMoodleRawText,
  readMoodleShuffle,
  readMoodleTextContent,
} from './moodle_xml_content.ts';

type HandlerContext = {
  title: string;
  identifier: string;
  tags?: string[];
  bodyHtml: string;
  assetMap: MoodleAssetContext;
};

type Handler = (
  questionEl: Element,
  ctx: HandlerContext,
  warnings: ImportWarning[],
) => UnlabeledImportDraft;

export const MOODLE_QUESTION_HANDLERS: Readonly<Record<string, Handler>> = {
  truefalse: buildTrueFalse,
  multichoice: buildMultiChoice,
  shortanswer: buildShortAnswer,
  numerical: buildNumerical,
  essay: buildEssay,
  matching: buildMatching,
  ordering: buildOrdering,
  cloze: buildCloze,
  ddwtos: buildDdwtos,
};

function buildTrueFalse(
  questionEl: Element,
  ctx: HandlerContext,
): UnlabeledImportDraft {
  const answers = findAllDescendantsByLocalName(questionEl, 'answer');
  const correct = answers.find((ans) => toNumber(attr(ans, 'fraction')) === 100) ?? answers[0];
  const correctText = (
    readMoodleTextContent(findDescendantByLocalName(correct ?? null, 'text')) || ''
  )
    .toLowerCase();
  const correctId = correctText.includes('false') ? 'FALSE' : 'TRUE';

  return {
    type: 'single_select',
    title: ctx.title,
    bodyHtml: ctx.bodyHtml,
    choices: [
      { id: 'TRUE', text: 'True' },
      { id: 'FALSE', text: 'False' },
    ],
    correctId,
    shuffle: readMoodleShuffle(questionEl),
    responseMode: 'all_or_nothing',
    tags: ctx.tags,
  };
}

function buildMultiChoice(
  questionEl: Element,
  ctx: HandlerContext,
  warnings: ImportWarning[],
): UnlabeledImportDraft {
  const single = (
    readMoodleTextContent(findDescendantByLocalName(questionEl, 'single')) || ''
  ).trim()
    .toLowerCase();
  const isSingle = single === '' || single === 'true' || single === '1';
  const answers = findAllDescendantsByLocalName(questionEl, 'answer');

  const choices = answers.map((ans, idx) => {
    const label = moodleChoiceLabel(idx);
    const html = readMoodleInlineHtml(ans, ctx.assetMap);
    return {
      id: label,
      html: html ? sanitizeInlineHtml(html) : undefined,
      text: html ? html.replace(/<[^>]*>/g, '').trim() || undefined : undefined,
    };
  });

  const fractions = answers.map((ans) => toNumber(attr(ans, 'fraction')) ?? 0);
  const responseMode = moodleChoiceScoring(fractions, isSingle, warnings);

  if (isSingle) {
    const maxIndex = fractions.length
      ? fractions.reduce((best, value, idx) => (value > fractions[best] ? idx : best), 0)
      : 0;
    const correctId = choices[maxIndex]?.id ?? choices[0]?.id ?? '';
    if (!correctId) {
      warnings.push({
        code: 'MISSING_CORRECT',
        message: 'No correct answer found for multichoice.',
      });
    }
    return {
      type: 'single_select',
      title: ctx.title,
      bodyHtml: ctx.bodyHtml,
      choices,
      correctId,
      shuffle: readMoodleShuffle(questionEl),
      responseMode,
      tags: ctx.tags,
    };
  }

  const correctIds = choices
    .filter((_choice, idx) => (fractions[idx] ?? 0) > 0)
    .map((choice) => choice.id);
  if (!correctIds.length && choices[0]) {
    warnings.push({
      code: 'MISSING_CORRECT',
      message: 'Multi-select question missing correct answers; defaulted to first choice.',
    });
    correctIds.push(choices[0].id);
  }
  return {
    type: 'multi_select',
    maximumScore: 1,
    title: ctx.title,
    bodyHtml: ctx.bodyHtml,
    choices,
    correctIds,
    shuffle: readMoodleShuffle(questionEl),
    responseMode,
    tags: ctx.tags,
  };
}

function buildShortAnswer(
  questionEl: Element,
  ctx: HandlerContext,
  warnings: ImportWarning[],
): UnlabeledImportDraft {
  const answers = findAllDescendantsByLocalName(questionEl, 'answer');
  const useCase = (
    readMoodleTextContent(findDescendantByLocalName(questionEl, 'usecase')) || ''
  ).trim();
  const caseSensitive = useCase === '1' || useCase.toLowerCase() === 'true';
  const values = answers.map((answer) =>
    findDescendantByLocalName(answer, 'text')?.textContent?.trim() ?? ''
  );
  if (values.some((value) => /(?<!\\)\*/.test(value))) {
    warnings.push({
      code: 'LMS_SCORING_REVIEW',
      message:
        'Source short-answer wildcards require explicit matching reconstruction. Compare the original patterns and configure supported answers before acceptance.',
    });
  }
  const slotId = 'RESPONSE';
  const placeholders = createPlaceholderHtml({ id: slotId, label: 'Answer' });
  const bodyHtml = appendPlaceholder(ctx.bodyHtml, placeholders);

  const textEntries: TextEntrySlot[] = [
    {
      id: slotId,
      label: 'Answer',
      responseBaseType: 'string',
      answers: answers.map((ans, index) => ({
        id: crypto.randomUUID(),
        value: values[index].replace(/\\\*/g, '*'),
        score: fractionToScore(attr(ans, 'fraction')),
        caseSensitive,
      })),
    },
  ];

  return {
    type: 'text_entry',
    title: ctx.title,
    bodyHtml,
    textEntries,
    tags: ctx.tags,
  };
}

function buildNumerical(
  questionEl: Element,
  ctx: HandlerContext,
  warnings: ImportWarning[],
): UnlabeledImportDraft {
  const answers = findAllDescendantsByLocalName(questionEl, 'answer');
  const tolerances = answers.map((answer) =>
    findDescendantByLocalName(answer, 'tolerance')?.textContent?.trim() ?? '0'
  );
  const hasUnits = findAllDescendantsByLocalName(questionEl, 'unit').length > 0;
  if (
    hasUnits || tolerances.some((value) => Number(value) !== 0) ||
    answers.some((answer) => !Number.isFinite(Number(readMoodleRawText(answer))))
  ) {
    warnings.push({
      code: 'LMS_SCORING_REVIEW',
      message: `Numerical source tolerances (${tolerances.join(', ')})${
        hasUnits ? ' and units' : ''
      } require explicit scoring reconstruction. Exact answer values are retained; configure supported matching before acceptance.`,
    });
  }
  const slotId = 'RESPONSE';
  const placeholders = createPlaceholderHtml({ id: slotId, label: 'Answer' });
  const bodyHtml = appendPlaceholder(ctx.bodyHtml, placeholders);

  const textEntries: TextEntrySlot[] = [
    {
      id: slotId,
      label: 'Answer',
      responseBaseType: 'float',
      answers: answers.map((ans) => ({
        id: crypto.randomUUID(),
        value: readMoodleRawText(ans),
        score: fractionToScore(attr(ans, 'fraction')),
        caseSensitive: true,
      })),
    },
  ];

  return {
    type: 'text_entry',
    title: ctx.title,
    bodyHtml,
    textEntries,
    tags: ctx.tags,
  };
}

function buildEssay(
  questionEl: Element,
  ctx: HandlerContext,
  warnings: ImportWarning[],
): UnlabeledImportDraft {
  const sourceFormat = readMoodleTextContent(
    findDescendantByLocalName(questionEl, 'responseformat'),
  );
  const lines = toNumber(findDescendantByLocalName(questionEl, 'responsefieldlines')?.textContent);
  const settings = [
    'minwordlimit',
    'maxwordlimit',
    'attachments',
    'attachmentsrequired',
    'responsetemplate',
  ];
  if (
    settings.some((name) => {
      const value = readMoodleTextContent(findDescendantByLocalName(questionEl, name));
      return value !== '' && value !== '0';
    })
  ) {
    warnings.push({
      code: 'LMS_CONTENT_REVIEW',
      message:
        'Review the original essay word limits, attachments and response template before delivery; these settings are not applied automatically.',
    });
  }
  return {
    type: 'extended_text',
    externalScored: 'human',
    title: ctx.title,
    bodyHtml: ctx.bodyHtml,
    responseIdentifier: 'RESPONSE',
    responseBaseType: 'string',
    responseCardinality: 'single',
    format: sourceFormat.startsWith('editor')
      ? 'xhtml'
      : sourceFormat === 'monospaced'
      ? 'preformatted'
      : 'plain',
    ...(lines !== null && Number.isInteger(lines) && lines > 0 && lines <= 100
      ? { expectedLines: lines }
      : {}),
    rubricHtml: readMoodleBodyHtml(
      findDescendantByLocalName(questionEl, 'graderinfo'),
      ctx.assetMap,
    ),
    heightClass: 'qti-height-lines-6',
    counterType: 'none',
    tags: ctx.tags,
  };
}

function buildMatching(
  questionEl: Element,
  ctx: HandlerContext,
  warnings: ImportWarning[],
): UnlabeledImportDraft {
  const subquestions = findAllDescendantsByLocalName(questionEl, 'subquestion');
  const sources: Array<{ id: string; html?: string; text?: string; matchMax?: number }> = [];
  const targets: Array<{ id: string; html?: string; text?: string; matchMax?: number }> = [];
  const correctPairs: Array<{ sourceId: string; targetId: string }> = [];
  const targetMap = new Map<string, string>();

  subquestions.forEach((sub, idx) => {
    const sourceId = `S${idx + 1}`;
    const sourceHtml = readMoodleInlineHtml(sub, ctx.assetMap);
    const sourceText = sourceHtml.replace(/<[^>]*>/g, '').trim();
    const answerText =
      findDescendantByLocalName(findDescendantByLocalName(sub, 'answer'), 'text')?.textContent
        ?.trim() ?? '';
    if (!answerText) return;
    let targetId = targetMap.get(answerText);
    if (!targetId) {
      targetId = `T${targetMap.size + 1}`;
      targetMap.set(answerText, targetId);
      targets.push({
        id: targetId,
        html: sanitizeInlineHtml(xmlEscape(answerText)),
        text: answerText,
        matchMax: 0,
      });
    }
    // Moodle's empty stem denotes an answer-only distractor, never a required pair.
    if (!sourceHtml.trim()) return;
    sources.push({ id: sourceId, html: sourceHtml, text: sourceText || undefined, matchMax: 1 });
    correctPairs.push({ sourceId, targetId });
  });

  if (correctPairs.length > 1) {
    warnings.push({
      code: 'LMS_SCORING_REVIEW',
      message:
        'Moodle matching awards independent credit per correct pair. This authoring model uses all-or-nothing matching. The original pairs are retained; use the original Moodle question for partial-credit delivery, or explicitly author an all-or-nothing version before acceptance.',
    });
  }
  return {
    type: 'match',
    shuffle: readMoodleShuffle(questionEl),
    title: ctx.title,
    bodyHtml: ctx.bodyHtml,
    sources,
    targets,
    correctPairs,
    tags: ctx.tags,
  };
}

function buildOrdering(
  questionEl: Element,
  ctx: HandlerContext,
  warnings: ImportWarning[],
): UnlabeledImportDraft {
  const answers = findAllDescendantsByLocalName(questionEl, 'answer');
  const choices = answers.map((ans, idx) => {
    const id = `C${idx + 1}`;
    const html = readMoodleInlineHtml(ans, ctx.assetMap);
    return {
      id,
      html: html ? sanitizeInlineHtml(html) : undefined,
      text: html ? html.replace(/<[^>]*>/g, '').trim() || undefined : undefined,
    };
  });
  const correctOrder = choices.map((choice) => choice.id);
  const grading = readMoodleTextContent(findDescendantByLocalName(questionEl, 'gradingtype'));
  const selection = readMoodleTextContent(findDescendantByLocalName(questionEl, 'selecttype'));
  const count = readMoodleTextContent(findDescendantByLocalName(questionEl, 'selectcount'));
  if (grading !== 'ALL_OR_NOTHING') {
    warnings.push({
      code: 'LMS_SCORING_REVIEW',
      message: `Source ordering grading ${
        grading || '(unspecified)'
      } cannot be preserved by all-or-nothing authoring. The original order is retained; use the original Moodle question for this grading rule, or explicitly author a supported version before acceptance.`,
    });
  }
  if (selection !== 'ALL') {
    warnings.push({
      code: 'LMS_CONTENT_REVIEW',
      message: `Source ordering selection ${selection || '(unspecified)'} with count ${
        count || '(unspecified)'
      } is converted to all ${choices.length} fixed choices. Use the original Moodle question when subset selection is required.`,
    });
  }
  return {
    type: 'order',
    title: ctx.title,
    bodyHtml: ctx.bodyHtml,
    choices,
    correctOrder,
    shuffle: true,
    responseMode: 'all_or_nothing',
    tags: ctx.tags,
  };
}

function buildCloze(
  _questionEl: Element,
  ctx: HandlerContext,
  warnings: ImportWarning[],
): UnlabeledImportDraft {
  const { bodyHtml, inlineSlots, textSlots, responseMode } = parseMoodleCloze(
    ctx.bodyHtml,
    warnings,
  );

  if (!inlineSlots.length && !textSlots.length) {
    warnings.push({
      code: 'CLOZE_EMPTY',
      message: 'Cloze question did not contain any blanks.',
      path: ctx.identifier,
    });
    return {
      type: 'extended_text',
      title: ctx.title,
      bodyHtml: ctx.bodyHtml,
      responseIdentifier: 'RESPONSE',
      responseBaseType: 'string',
      responseCardinality: 'single',
      format: 'plain',
      heightClass: 'qti-height-lines-6',
      counterType: 'none',
      tags: ctx.tags,
    };
  }

  if (inlineSlots.length && textSlots.length) {
    warnings.push({
      code: 'CLOZE_MIXED',
      message: 'Cloze mixes choice and short answer. Imported as text entry only.',
      path: ctx.identifier,
    });
    const mergedSlots: TextEntrySlot[] = [
      ...textSlots,
      ...inlineSlots.map((slot): TextEntrySlot => ({
        id: slot.id,
        label: slot.label,
        responseBaseType: 'string',
        answers: slot.options.map((opt) => ({
          id: crypto.randomUUID(),
          value: opt.text?.trim() || opt.id,
          score: opt.score ?? (opt.id === slot.correctId ? 1 : 0),
          caseSensitive: false,
        })),
      })),
    ];
    return {
      type: 'text_entry',
      title: ctx.title,
      bodyHtml,
      textEntries: mergedSlots,
      tags: ctx.tags,
    };
  }

  if (inlineSlots.length) {
    return {
      type: 'inline_choice',
      title: ctx.title,
      bodyHtml,
      inlineChoices: inlineSlots,
      responseMode,
      tags: ctx.tags,
    };
  }

  return {
    type: 'text_entry',
    title: ctx.title,
    bodyHtml,
    textEntries: textSlots,
    tags: ctx.tags,
  };
}

function buildDdwtos(
  questionEl: Element,
  ctx: HandlerContext,
  warnings: ImportWarning[],
): UnlabeledImportDraft {
  const dragboxes = findAllDescendantsByLocalName(questionEl, 'dragbox');
  const groups = new Set(
    dragboxes.map((drag) => readMoodleTextContent(findDescendantByLocalName(drag, 'group')) || '1'),
  );
  const choices: GapMatchChoice[] = dragboxes.map((drag, index) => ({
    id: `CHOICE_${index + 1}`,
    kind: 'text',
    html: readMoodleInlineHtml(drag, ctx.assetMap),
    matchMax: findDescendantByLocalName(drag, 'infinite') ? 0 : 1,
  }));
  const gaps: GapTarget[] = [];
  const correctGapPairs: Array<{ choiceId: string; gapId: string }> = [];
  const usage = new Map<string, number>();
  const bodyHtml = ctx.bodyHtml.replace(/\[\[(\d+)\]\]/g, (_match, rawIndex: string) => {
    const id = `GAP_${gaps.length + 1}`;
    gaps.push({ id, label: `Gap ${gaps.length + 1}` });
    const choice = choices[Number(rawIndex) - 1];
    if (choice) {
      correctGapPairs.push({ choiceId: choice.id, gapId: id });
      usage.set(choice.id, (usage.get(choice.id) ?? 0) + 1);
    } else {warnings.push({
        code: 'DDWTOS_NO_CORRECT',
        message:
          `Source gap references unavailable dragbox ${rawIndex}. Restore the original choice and import again.`,
      });}
    return createGapMarkerHtml({ id, label: `Gap ${gaps.length}` });
  });
  if (!correctGapPairs.length) {
    warnings.push({
      code: 'DDWTOS_NO_CORRECT',
      message: 'Source drag-and-drop text contains no valid gap-to-choice mappings.',
    });
  }
  if (
    gaps.length > 1 ||
    choices.some((choice) => choice.matchMax === 1 && (usage.get(choice.id) ?? 0) > 1)
  ) {
    warnings.push({
      code: 'LMS_SCORING_REVIEW',
      message:
        'The source dragboxes, gaps and reuse settings are retained. Moodle normalizes credit across gaps; this gap-match model uses unscaled pair points. Use the original Moodle question for normalized grading or explicitly rebuild supported scoring before acceptance.',
    });
  }
  if (groups.size > 1) {
    warnings.push({
      code: 'LMS_CONTENT_REVIEW',
      message: `Source dragbox groups (${
        [...groups].join(', ')
      }) are retained in the original XML but converted to one choice set. Recreate group restrictions before delivery if required.`,
    });
  }
  return {
    type: 'gap_match',
    title: ctx.title,
    promptHtml: '',
    bodyHtml: sanitizeBodyHtml(bodyHtml),
    gapChoices: choices,
    gaps,
    correctGapPairs,
    shuffle: readMoodleShuffle(questionEl),
    tags: ctx.tags,
  };
}

function appendPlaceholder(bodyHtml: string, placeholder: string): string {
  const clean = sanitizeBodyHtml(bodyHtml || '');
  if (!clean || clean === '<p></p>') return `<p>${placeholder}</p>`;
  return `${clean}\n<p>${placeholder}</p>`;
}

function fractionToScore(value?: string | null): number {
  if (value == null || value === '') return 0;
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num / 100;
}
