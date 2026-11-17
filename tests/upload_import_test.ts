import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { type UploadDraft } from '../lib/types/upload.ts';
import { draftOfType } from './import_draft.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'upload.xml';

testCase('upload import: fixture → draft preserves fields', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<UploadDraft>(parsed, 'upload');
  expect(draft.responseIdentifier).toStrictEqual('RESPONSE');
  if (!((draft.bodyHtml ?? '').includes('chocolate factory'))) {
    expect.unreachable("Expected (draft.bodyHtml ?? '').includes('chocolate factory')");
  }
  if (!((draft.promptHtml ?? '').includes('spreadsheet'))) {
    expect.unreachable("Expected (draft.promptHtml ?? '').includes('spreadsheet')");
  }
});

testCase('upload import round-trip: fixture → draft → qti3 export → re-import', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<UploadDraft>(parsed, 'upload');
  const rebuilt = exportQti3TestItemXml('upload', {
    title: draft.title,
    promptHtml: draft.promptHtml,
    bodyHtml: draft.bodyHtml,
    responseIdentifier: draft.responseIdentifier,
  }, { identifier: 'item-upload-roundtrip' });

  if (!(rebuilt.includes('<qti-upload-interaction'))) {
    expect.unreachable("Expected rebuilt.includes('<qti-upload-interaction')");
  }
  await assertQtiXmlWellFormed(rebuilt);

  const reparsed = parseItemXml(rebuilt);
  const reDraft = draftOfType<UploadDraft>(reparsed, 'upload');
  expect(reDraft.responseIdentifier).toStrictEqual('RESPONSE');
});
