import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { type EndAttemptDraft } from '../lib/types/end_attempt.ts';
import { draftOfType } from './import_draft.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'end-attempt-only.xml';

testCase('end_attempt import: fixture → draft preserves fields', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<EndAttemptDraft>(parsed, 'end_attempt');
  expect(draft.responseIdentifier).toStrictEqual('END_ATTEMPT');
  expect(draft.endAttemptTitle).toStrictEqual('End Attempt');
  expect(draft.endAttemptCountAttempt).toStrictEqual(true);
});

testCase('end_attempt import round-trip: fixture → draft → qti3 export → re-import', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<EndAttemptDraft>(parsed, 'end_attempt');
  const rebuilt = exportQti3TestItemXml('end_attempt', {
    title: draft.title,
    promptHtml: draft.promptHtml,
    bodyHtml: draft.bodyHtml,
    responseIdentifier: draft.responseIdentifier,
    endAttemptTitle: draft.endAttemptTitle,
    endAttemptCountAttempt: draft.endAttemptCountAttempt,
  }, { identifier: 'item-end-attempt-roundtrip' });
  await assertQtiXmlWellFormed(rebuilt);

  const reparsed = parseItemXml(rebuilt);
  expect(draftOfType<EndAttemptDraft>(reparsed, 'end_attempt').responseIdentifier).toStrictEqual(
    'END_ATTEMPT',
  );
});
