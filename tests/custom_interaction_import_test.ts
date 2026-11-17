import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';

import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';

testCase('custom_interaction import: xml → draft preserves fields', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item
  xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0
    https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd"
  identifier="item-custom-import" title="Custom Import" time-dependent="false" xml:lang="en-US">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="integer"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-item-body>
    <p>Use the widget below.</p>
    <qti-custom-interaction response-identifier="RESPONSE" class="customWidget" data-mode="alpha">
      <qti-prompt>Answer with the widget.</qti-prompt>
      <div class="widget">Hello</div>
    </qti-custom-interaction>
  </qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>
</qti-assessment-item>`;

  const parsed = parseItemXml(xml);
  expect(parsed.draft.type).toStrictEqual('custom_interaction');
  expect(parsed.draft.responseIdentifier).toStrictEqual('RESPONSE');
  expect(parsed.draft.customBaseType).toStrictEqual('integer');
  expect(parsed.draft.customCardinality).toStrictEqual('single');
  expect(parsed.draft.customClassName).toStrictEqual('customWidget');
  if (!((parsed.draft.promptHtml ?? '').includes('Answer with the widget.'))) {
    expect.unreachable(
      "Expected (parsed.draft.promptHtml ?? '').includes('Answer with the widget.')",
    );
  }
  // qti3-core does not parse custom-interaction inner HTML yet.
  expect(parsed.draft.customInteractionMarkup).toStrictEqual(undefined);
  if (
    !(parsed.draft.customAttributes?.some((attr) =>
      attr.name === 'data-mode' && attr.value === 'alpha'
    ))
  ) {
    expect.unreachable(
      "Expected parsed.draft.customAttributes?.some((attr) => attr.name === 'data-mode' && attr.value === ",
    );
  }
  if (
    !((parsed.draft.customResponseProcessingXml ?? '').includes(
      'https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct',
    ))
  ) {
    expect.unreachable(
      "Expected (parsed.draft.customResponseProcessingXml ?? '').includes( 'https://purl.imsglobal.org/spe",
    );
  }
});

testCase('custom_interaction import round-trip: draft → qti3 export → re-import', async () => {
  const base = {
    title: 'Custom Roundtrip',
    promptHtml: 'Solve using the custom tool.',
    bodyHtml: '<p>Custom body.</p>',
    responseIdentifier: 'RESPONSE',
    customBaseType: 'string',
    customCardinality: 'single' as const,
    customClassName: 'customWidget',
    customDefinition: 'https://example.com/custom',
    customAttributes: [{ name: 'data-mode', value: 'beta' }],
    customInteractionMarkup: '<div class="widget">Roundtrip</div>',
    customResponseProcessingXml:
      '<qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/map_response"/>',
  };

  const rebuilt = exportQti3TestItemXml('custom_interaction', base, {
    identifier: 'item-custom-roundtrip',
  });
  await assertQtiXmlWellFormed(rebuilt);

  const reparsed = parseItemXml(rebuilt);
  expect(reparsed.draft.type).toStrictEqual('custom_interaction');
  expect(reparsed.draft.responseIdentifier).toStrictEqual('RESPONSE');
  expect(reparsed.draft.customClassName).toStrictEqual('customWidget');
  if (
    !(reparsed.draft.customAttributes?.some((attr) =>
      attr.name === 'data-mode' && attr.value === 'beta'
    ))
  ) {
    expect.unreachable(
      "Expected reparsed.draft.customAttributes?.some((attr) => attr.name === 'data-mode' && attr.value ==",
    );
  }
  if (
    !((reparsed.draft.customResponseProcessingXml ?? '').includes(
      'https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/map_response',
    ))
  ) {
    expect.unreachable(
      "Expected (reparsed.draft.customResponseProcessingXml ?? '').includes( 'https://purl.imsglobal.org/s",
    );
  }
  // Markup round-trip is blocked until qti3-core surfaces custom-interaction child content.
  expect(reparsed.draft.customInteractionMarkup).toStrictEqual(undefined);
});
