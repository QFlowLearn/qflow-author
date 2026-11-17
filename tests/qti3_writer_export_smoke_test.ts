import { expect, test as testCase } from 'vitest';

import { parseQtiXml, validateAssessmentItem } from '@longsightgroup/qti3-core';
import {
  exportQti3AssessmentItemXml,
  QflowQti3WriterExportError,
  toQti3AuthoringItem,
} from '../lib/types/qti3_authoring.ts';
import type { Draft } from '../lib/types/draft.ts';
import { QUESTION_TYPE_IDS, type QuestionTypeId, TYPE_DRIVERS } from '../lib/types/registry.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { parseItemLanguage } from '../lib/types/item_language.ts';
import { hydrateDriverDraft, serializeDriverDraft } from '../lib/types/registry.ts';

const QFLOW_DRAFT_LEAK_DENYLIST = [
  'correctId',
  'correctIds',
  'correctPairs',
  'correctGapPairs',
  'hotspotImageSrc',
  'hotspotImageAlt',
  'graphicBackgroundSrc',
  'graphicAssociateBackgroundSrc',
  'graphicOrderBackgroundSrc',
  'data-qti-hottext',
  'data-qti-inline-choice',
  'data-qti-gap',
  'sliderLowerBound',
  'sliderUpperBound',
  'drawingImageSrc',
  'portableInteractionMarkup',
];

testCase('qflow QTI 3 export boundary adapts every supported draft through qti3-writer', () => {
  for (const typeId of QUESTION_TYPE_IDS) {
    const draft = buildableDefaultDraft(typeId);
    const authoringItem = toQti3AuthoringItem(typeId, draft, {
      identifier: `item-${typeId}`,
    });
    if (!(authoringItem.interactionType)) {
      expect.unreachable(`${typeId}: missing writer interactionType`);
    }

    const xml = exportQti3AssessmentItemXml(typeId, draft, {
      identifier: `item-${typeId}`,
    });
    assertNoQflowDraftNamesLeak(typeId, xml);

    const parsed = parseQtiXml(xml);
    expect(parsed.ok, `${typeId}: parse diagnostics\n${formatDiagnostics(parsed.diagnostics)}`)
      .toStrictEqual(true);
    if (!(parsed.document)) expect.unreachable(`${typeId}: parser did not return a document`);
    expect(parsed.document.item.identifier, `${typeId}: parsed identifier`).toStrictEqual(
      `item-${typeId}`,
    );

    const validation = validateAssessmentItem(parsed.document);
    expect(
      validation.ok,
      `${typeId}: validation diagnostics\n${formatDiagnostics(validation.diagnostics)}`,
    ).toStrictEqual(true);
  }
});

testCase('QTI build preserves canonical item language through driver lifecycle', () => {
  for (const rawLanguage of ['es-ES', 'es-419', 'fr-CA']) {
    const itemLanguage = parseItemLanguage(rawLanguage);
    const source: Draft = {
      type: 'single_select',
      itemLanguage,
      title: 'Language round trip',
      bodyHtml: '<p>Choose one.</p>',
      choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
      correctId: 'A',
    };
    const hydrated = hydrateDriverDraft('single_select', source);
    expect(hydrated.itemLanguage).toStrictEqual(itemLanguage);
    const serialized = serializeDriverDraft('single_select', hydrated);
    expect(serialized.itemLanguage).toStrictEqual(itemLanguage);
    const authoring = toQti3AuthoringItem('single_select', serialized, { identifier: 'language' });
    expect(authoring.lang).toStrictEqual(itemLanguage);
    const result = parseQtiXml(exportQti3AssessmentItemXml('single_select', serialized, {
      identifier: 'language',
    }));
    if (!(result.ok)) expect.unreachable('generated XML should parse');
    expect(result.document?.item.language).toStrictEqual(itemLanguage);
  }
});

testCase('QTI public authoring API does not accept a language override', () => {
  const draft = buildableDefaultDraft('single_select');
  // @ts-expect-error item language is owned by Draft, not public writer options.
  toQti3AuthoringItem('single_select', draft, { lang: 'en-US' });
});

testCase('qflow QTI 3 export boundary does not silently repair invalid native drafts', () => {
  assertWriterRejects('inline_choice', {
    ...buildableDefaultDraft('inline_choice'),
    inlineChoices: [{
      id: 'RESPONSE',
      label: 'Blank',
      options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }],
      correctId: undefined,
    }],
    bodyHtml: '<p><span data-qti-inline-choice="RESPONSE">Blank</span></p>',
  }, 'slots.0.correctResponse');

  assertWriterRejects('gap_match', {
    ...buildableDefaultDraft('gap_match'),
    gapChoices: [{ id: 'A', kind: 'text', text: 'Choice A', matchMax: 1 }],
    gaps: [{ id: 'A', label: 'Gap A' }],
    correctGapPairs: [{ choiceId: 'A', gapId: 'A' }],
    bodyHtml: '<p><span data-qti-gap="A">Gap A</span></p>',
  }, 'choices|targets');

  assertWriterRejects('drawing', {
    ...buildableDefaultDraft('drawing'),
    drawingImageAlt: '',
  }, 'object.alt');
});

function buildableDefaultDraft(typeId: QuestionTypeId): Draft {
  const driver = TYPE_DRIVERS[typeId];
  const defaults = {
    ...driver.defaults(),
    type: typeId,
    itemLanguage: newAuthoringItemLanguage(),
  };
  const serialized = driver.serialize(defaults);
  return prepareDriverDraftForBuild(typeId, serialized);
}

function assertNoQflowDraftNamesLeak(typeId: QuestionTypeId, xml: string): void {
  for (const token of QFLOW_DRAFT_LEAK_DENYLIST) {
    if (xml.includes(token)) {
      expect.unreachable(`${typeId}: generated XML leaked qflow draft/editor token "${token}"`);
    }
  }
}

function assertWriterRejects(
  typeId: QuestionTypeId,
  draft: Draft,
  expectedPath: string,
): void {
  try {
    exportQti3AssessmentItemXml(typeId, draft, { identifier: `invalid-${typeId}` });
  } catch (err) {
    if (!(err instanceof QflowQti3WriterExportError)) {
      expect.unreachable(`${typeId}: unexpected error type`);
    }
    if (!(err.diagnostics.some((diagnostic) => diagnostic.path === expectedPath))) {
      expect.unreachable(
        `${typeId}: expected writer diagnostic path ${expectedPath}, got ${
          formatDiagnostics(err.diagnostics)
        }`,
      );
    }
    return;
  }
  throw new Error(`${typeId}: writer accepted an invalid draft`);
}

function formatDiagnostics(
  diagnostics: readonly { code?: string; path?: string; message: string }[],
) {
  return diagnostics
    .map((diagnostic) =>
      `${diagnostic.code ?? 'diagnostic'} ${diagnostic.path ?? '<unknown>'}: ${diagnostic.message}`
    )
    .join('\n');
}
