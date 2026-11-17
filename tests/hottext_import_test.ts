import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { HOTTEXT_MARKER_ATTR, type HottextDraft } from '../lib/types/hottext.ts';
import { draftOfType } from './import_draft.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'hottext-qti3.xml';

testCase('hottext import: fixture → draft contains markers + spans', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<HottextDraft>(parsed, 'hottext');
  if (!((draft.bodyHtml ?? '').includes(HOTTEXT_MARKER_ATTR))) {
    expect.unreachable("Expected (draft.bodyHtml ?? '').includes(HOTTEXT_MARKER_ATTR)");
  }

  const spans = draft.hottexts ?? [];
  const correct = draft.correctIds ?? [];

  if (!(spans.length >= 1)) expect.unreachable('Expected spans.length >= 1');
  if (!(correct.length >= 1)) expect.unreachable('Expected correct.length >= 1');
  if (!(spans.every((span) => typeof span.id === 'string' && span.id.length > 0))) {
    expect.unreachable(
      "Expected spans.every((span) => typeof span.id === 'string' && span.id.length > 0)",
    );
  }
  if (!(correct.every((id: unknown) => typeof id === 'string' && id.length > 0))) {
    expect.unreachable(
      "Expected correct.every((id: unknown) => typeof id === 'string' && id.length > 0)",
    );
  }
});

testCase('hottext import round-trip: fixture → draft → qti3 export → re-import', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<HottextDraft>(parsed, 'hottext');
  const rebuilt = exportQti3TestItemXml('hottext', draft, { identifier: 'item-hottext-roundtrip' });
  await assertQtiXmlWellFormed(rebuilt);

  draftOfType<HottextDraft>(parseItemXml(rebuilt), 'hottext');
});
