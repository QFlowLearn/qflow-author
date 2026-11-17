import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { type ExtendedTextDraft } from '../lib/types/extended_text.ts';
import { draftOfType } from './import_draft.ts';
import { readQtiFixture } from './qti_fixture_loader.ts';

const FIXTURE = 'extended_text_rubric.xml';
const SHARED_FIXTURE = 'extended_text_qti3.xml';

testCase('extended text import: fixture → draft contains body + rubric', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<ExtendedTextDraft>(parsed, 'extended_text');

  const bodyHtml = draft.bodyHtml ?? '';
  const rubricHtml = draft.rubricHtml ?? '';
  const responseIdentifier = draft.responseIdentifier ?? '';

  if (!(bodyHtml.includes('postcard') || bodyHtml.includes('Postcard'))) {
    expect.unreachable("Expected bodyHtml.includes('postcard') || bodyHtml.includes('Postcard')");
  }
  if (!(rubricHtml.includes('Scoring Guidelines'))) {
    expect.unreachable("Expected rubricHtml.includes('Scoring Guidelines')");
  }
  if (!(typeof responseIdentifier === 'string' && responseIdentifier.length > 0)) {
    expect.unreachable(
      "Expected typeof responseIdentifier === 'string' && responseIdentifier.length > 0",
    );
  }
});

testCase('extended text import round-trip: fixture → draft → qti3 export → re-import', async () => {
  const xml = await readQtiFixture(FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<ExtendedTextDraft>(parsed, 'extended_text');
  const rebuilt = exportQti3TestItemXml('extended_text', draft, {
    identifier: 'item-extended-text-roundtrip',
  });
  await assertQtiXmlWellFormed(rebuilt);

  draftOfType<ExtendedTextDraft>(parseItemXml(rebuilt), 'extended_text');
});

testCase('extended text import: shared vocabulary fixture preserves image', async () => {
  const xml = await readQtiFixture(SHARED_FIXTURE);

  const parsed = parseItemXml(xml);
  const draft = draftOfType<ExtendedTextDraft>(parsed, 'extended_text');
  const bodyHtml = draft.bodyHtml ?? '';
  if (!(bodyHtml.includes('images/postcard.png'))) {
    expect.unreachable("Expected bodyHtml.includes('images/postcard.png')");
  }
  expect(draft.expectedLength).toStrictEqual(200);
  expect(draft.format).toStrictEqual('plain');
  expect(draft.heightClass).toStrictEqual('qti-height-lines-3');
});

testCase('extended text import/export preserves XHTML response format', async () => {
  const parsed = parseItemXml(XHTML_EXTENDED_TEXT_XML);
  const draft = draftOfType<ExtendedTextDraft>(parsed, 'extended_text');
  expect(draft.format).toStrictEqual('xhtml');

  const rebuilt = exportQti3TestItemXml('extended_text', draft, {
    identifier: 'extended-text-xhtml-roundtrip',
  });

  if (!(rebuilt.includes('format="xhtml"'))) {
    expect.unreachable('Expected rebuilt.includes(\'format="xhtml"\')');
  }
  await assertQtiXmlWellFormed(rebuilt);

  const reparsed = parseItemXml(rebuilt);
  expect(draftOfType<ExtendedTextDraft>(reparsed, 'extended_text').format).toStrictEqual('xhtml');
});

const XHTML_EXTENDED_TEXT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item
  xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
  identifier="extended-text-xhtml"
  title="Extended text XHTML"
  xml:lang="en-US"
  time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-item-body>
    <p>Use rich formatting in the response.</p>
    <qti-extended-text-interaction
      response-identifier="RESPONSE"
      expected-length="200"
      expected-lines="6"
      format="xhtml">
      <qti-prompt>Write a formatted response.</qti-prompt>
    </qti-extended-text-interaction>
  </qti-item-body>
</qti-assessment-item>`;
