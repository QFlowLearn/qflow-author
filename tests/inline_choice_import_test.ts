import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseQtiXml, scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { qtiDocumentToDraft } from '../lib/import/adapters/qti3/qti_document_to_draft.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { INLINE_CHOICE_MARKER_ATTR, type InlineChoiceDraft } from '../lib/types/inline_choice.ts';
import { draftOfType } from './import_draft.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'inline_choice_qti3.xml';

testCase(
  'inline_choice extraction retains markers and slots but unscored source requires review',
  async () => {
    const xml = await readQtiFixture(FIXTURE);

    const document = parseQtiXml(xml).document;
    if (!document) expect.unreachable('Expected document');
    const parsed = qtiDocumentToDraft(document);
    expect(parsed.draft.type).toStrictEqual('inline_choice');
    if (!((parsed.draft.bodyHtml ?? '').includes(INLINE_CHOICE_MARKER_ATTR))) {
      expect.unreachable(
        "Expected (parsed.draft.bodyHtml ?? '').includes(INLINE_CHOICE_MARKER_ATTR)",
      );
    }

    const slots = parsed.draft.inlineChoices ?? [];
    if (!(slots.length >= 1)) expect.unreachable('Expected slots.length >= 1');
    if (!(slots[0].options.length >= 2)) {
      expect.unreachable('Expected slots[0].options.length >= 2');
    }
    if (!(slots.every((slot) => typeof slot.id === 'string' && slot.id.length > 0))) {
      expect.unreachable(
        "Expected slots.every((slot) => typeof slot.id === 'string' && slot.id.length > 0)",
      );
    }
    if (
      !(slots.every((slot) =>
        slot.options.every((opt) => typeof opt.id === 'string' && opt.id.length > 0)
      ))
    ) {
      expect.unreachable(
        "Expected slots.every((slot) => slot.options.every((opt) => typeof opt.id === 'string' && opt.id.len",
      );
    }
    if (!(typeof slots[0].correctId === 'string' && slots[0].correctId.length > 0)) {
      expect.unreachable(
        "Expected typeof slots[0].correctId === 'string' && slots[0].correctId.length > 0",
      );
    }
    expect(() => parseItemXml(xml)).toThrowError(
      expect.toSatisfy((caught: unknown) =>
        caught instanceof Error && caught.message.includes('points')
      ),
    );
  },
);

testCase(
  'explicitly authored inline choice keys and processing retain literal grades through re-import',
  async () => {
    const xml = await readQtiFixture(FIXTURE);

    const document = parseQtiXml(xml).document;
    if (!document) expect.unreachable('Expected document');
    const extracted = draftOfType<InlineChoiceDraft>(qtiDocumentToDraft(document), 'inline_choice');
    // These keys are explicitly supplied for a new synthetic authored question. Importing
    // the unchanged fixture above never authorizes guessing keys or creating this program.
    const draft = {
      ...extracted,
      responseMode: 'all_or_nothing' as const,
      inlineChoices: extracted.inlineChoices.map((slot) => ({ ...slot, correctId: 'Y' })),
      importWarnings: undefined,
    };
    const rebuilt = exportQti3TestItemXml('inline_choice', draft, {
      identifier: 'item-inline-choice-roundtrip',
    });
    await assertQtiXmlWellFormed(rebuilt);

    const imported = draftOfType<InlineChoiceDraft>(parseItemXml(rebuilt), 'inline_choice');
    const roundtrip = exportQti3TestItemXml('inline_choice', imported);
    const responses = Object.fromEntries(draft.inlineChoices.map((slot) => [slot.id, 'Y']));
    expect(draft.inlineChoices.length).toStrictEqual(11);
    for (const itemXml of [rebuilt, roundtrip]) {
      const graded = scoreQtiItemServerSide({ itemXml, trustedResponses: responses });
      if (!(graded.ok)) expect.unreachable('Expected graded.ok');
      expect(graded.score).toStrictEqual(11);
    }
  },
);
