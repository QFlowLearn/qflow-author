import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { createGapMarkerHtml, defaultsGapMatch } from '../lib/types/gap_match.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';

testCase(
  'gap_match export emits gap-match-interaction, gaps, and directedPair responseDeclaration',
  async () => {
    const draft = defaultsGapMatch();
    const xml = exportQti3TestItemXml('gap_match', draft, { identifier: 'item-gap-match-1' });

    if (!(xml.includes('<qti-gap-match-interaction'))) {
      expect.unreachable("Expected xml.includes('<qti-gap-match-interaction')");
    }
    if (!(xml.includes('response-identifier="RESPONSE"'))) {
      expect.unreachable('Expected xml.includes(\'response-identifier="RESPONSE"\')');
    }
    if (!(xml.includes('<qti-gap-text identifier="A" match-max="1">'))) {
      expect.unreachable('Expected xml.includes(\'<qti-gap-text identifier="A" match-max="1">\')');
    }
    if (!(xml.includes('<qti-gap identifier="GAP_1"/>'))) {
      expect.unreachable('Expected xml.includes(\'<qti-gap identifier="GAP_1"/>\')');
    }
    if (
      !(xml.includes(
        '<qti-response-declaration identifier="RESPONSE" cardinality="multiple" base-type="directedPair">',
      ))
    ) {
      expect.unreachable(
        'Expected xml.includes( \'<qti-response-declaration identifier="RESPONSE" cardinality="multiple" base',
      );
    }
    if (
      !(xml.includes(
        '<qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/map_response"/>',
      ))
    ) {
      expect.unreachable(
        'Expected xml.includes( \'<qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0',
      );
    }

    await assertQtiXmlWellFormed(xml);
  },
);

testCase('gap_match central qti3 export accepts driver defaults', async () => {
  const draft = TYPE_DRIVERS.gap_match.defaults();
  const xml = exportQti3TestItemXml('gap_match', draft, { identifier: 'item-gap-match-driver' });
  if (!(xml.includes('<qti-gap-match-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-gap-match-interaction')");
  }
  await assertQtiXmlWellFormed(xml);
});

testCase('gap_match export wraps body blocks after gap choices', async () => {
  const draft = defaultsGapMatch();
  draft.bodyHtml = [
    `<p>The first President was ${createGapMarkerHtml({ id: 'GAP_1', label: 'Gap 1' })}.</p>`,
    `<p>The President who issued the Emancipation Proclamation was ${
      createGapMarkerHtml({ id: 'GAP_2', label: 'Gap 2' })
    }.</p>`,
  ].join('\n');

  const xml = exportQti3TestItemXml('gap_match', draft, {
    identifier: 'item-gap-match-wrapped-body',
  });

  if (
    !(xml.includes(
      [
        '      <div>',
        '        <p>The first President was <qti-gap identifier="GAP_1"/>.</p>',
        '        <p>The President who issued the Emancipation Proclamation was <qti-gap identifier="GAP_2"/>.</p>',
        '      </div>',
      ].join('\n'),
    ))
  ) {
    expect.unreachable(
      "Expected xml.includes( [ ' <div>', ' <p>The first President was <qti-gap identifier=\"GAP_1\"/>.</p>'",
    );
  }

  await assertQtiXmlWellFormed(xml);
});

testCase(
  'gap_match export emits min/max associations and shared-vocab messages when provided',
  async () => {
    const draft = defaultsGapMatch();
    draft.minAssociations = 1;
    draft.maxAssociations = 2;
    draft.minAssociationsMessage = "You haven't selected enough";
    draft.maxAssociationsMessage = "You've selected too many";

    const xml = exportQti3TestItemXml('gap_match', draft, { identifier: 'item-gap-match-2' });
    if (!(xml.includes('min-associations="1"'))) {
      expect.unreachable('Expected xml.includes(\'min-associations="1"\')');
    }
    if (!(xml.includes('max-associations="2"'))) {
      expect.unreachable('Expected xml.includes(\'max-associations="2"\')');
    }
    if (!(xml.includes('data-min-selections-message="You haven\'t selected enough"'))) {
      expect.unreachable(
        "Expected xml.includes('data-min-selections-message=\"You haven\\'t selected enough\"')",
      );
    }
    if (!(xml.includes('data-max-selections-message="You\'ve selected too many"'))) {
      expect.unreachable(
        "Expected xml.includes('data-max-selections-message=\"You\\'ve selected too many\"')",
      );
    }

    await assertQtiXmlWellFormed(xml);
  },
);
