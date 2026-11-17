import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import {
  defaultsGraphicGapMatch,
  validateGraphicGapMatch,
} from '../lib/types/graphic_gap_match.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';

testCase('graphic_gap_match export emits graphic-gap-match-interaction and hotspots', async () => {
  const draft = defaultsGraphicGapMatch();
  // ensure mime inference gets type
  draft.graphicBackgroundSrc = 'background.png';
  draft.choices = draft.choices.map((c, idx) =>
    idx === 0
      ? { ...c, kind: 'text', text: `Choice ${c.id}` }
      : { ...c, kind: 'image', imgSrc: 'choice.png' }
  );
  const xml = exportQti3TestItemXml('graphic_gap_match', draft, {
    identifier: 'item-graphic-gap-1',
  });

  if (!(xml.includes('<qti-graphic-gap-match-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-graphic-gap-match-interaction')");
  }
  if (!(xml.includes('<qti-gap-text identifier="A"'))) {
    expect.unreachable('Expected xml.includes(\'<qti-gap-text identifier="A"\')');
  }
  if (!(xml.includes('<qti-gap-img identifier="B"'))) {
    expect.unreachable('Expected xml.includes(\'<qti-gap-img identifier="B"\')');
  }
  if (!(xml.includes('<qti-associable-hotspot identifier="T1"'))) {
    expect.unreachable('Expected xml.includes(\'<qti-associable-hotspot identifier="T1"\')');
  }

  await assertQtiXmlWellFormed(xml);
});

testCase('graphic_gap_match export supports map_response scoring', async () => {
  const draft = defaultsGraphicGapMatch();
  const xml = exportQti3TestItemXml('graphic_gap_match', draft, {
    identifier: 'item-graphic-gap-map-response',
    scoring: 'map_response',
  });

  if (!(xml.includes('<qti-mapping default-value="0">'))) {
    expect.unreachable('Expected xml.includes(\'<qti-mapping default-value="0">\')');
  }
  if (!(xml.includes('map-key="A T1"'))) {
    expect.unreachable('Expected xml.includes(\'map-key="A T1"\')');
  }
  if (!(xml.includes('rptemplates/map_response'))) {
    expect.unreachable("Expected xml.includes('rptemplates/map_response')");
  }
  await assertQtiXmlWellFormed(xml);
});

testCase('graphic_gap_match central qti3 export accepts driver defaults', async () => {
  const draft = TYPE_DRIVERS.graphic_gap_match.defaults();
  const xml = exportQti3TestItemXml('graphic_gap_match', draft, {
    identifier: 'item-graphic-gap-driver',
  });
  if (!(xml.includes('<qti-graphic-gap-match-interaction'))) {
    expect.unreachable("Expected xml.includes('<qti-graphic-gap-match-interaction')");
  }
  await assertQtiXmlWellFormed(xml);
});

testCase('graphic_gap_match requires MIME metadata for extensionless images', () => {
  const draft = defaultsGraphicGapMatch();
  draft.graphicBackgroundSrc = '/uploads/background';
  draft.graphicBackgroundType = '';
  draft.choices[0] = {
    ...draft.choices[0],
    kind: 'image',
    imgSrc: '/uploads/choice-a',
    imgType: '',
  };

  expect(validateGraphicGapMatch(draft).filter((error) => error.includes('MIME type')))
    .toStrictEqual([
      'Background MIME type is required when it cannot be inferred from the image source.',
      'Choice "A" MIME type is required when it cannot be inferred from the image source.',
    ]);
});
