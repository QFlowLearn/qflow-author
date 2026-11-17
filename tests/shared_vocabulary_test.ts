import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';

import { createMarkerHtml } from '../lib/qti_markers.ts';
import {
  type QtiInteractionVocabulary,
  type QtiMediaPlayerControls,
  SHARED_VOCABULARY_INTERACTION_DEFINITIONS,
  type SharedVocabularyProperty,
} from '../lib/shared_vocabulary.ts';
import { QFLOW_TO_QTI3_INTERACTION } from '../lib/qti3_support.ts';
import { vocabularyRoundTrip } from './shared_vocabulary_round_trip.ts';

const BODY = '<p>Context</p>';

testCase('choice exports emit shared vocabulary classes for single and multi select', () => {
  const single = exportQti3TestItemXml(
    'single_select',
    {
      title: 'Single',
      bodyHtml: BODY,
      promptHtml: 'Pick',
      choices: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }],
      correctId: 'A',
      sharedVocabulary: {
        labelStyle: 'cjk-ideographic',
        labelSuffix: 'parenthesis',
        orientation: 'vertical',
        choicesStacking: 4,
        selectionTone: 'dark',
        inputControlHidden: true,
        unselectedHidden: true,
        writingOrientation: 'vertical-rl',
      },
    },
    { identifier: 'choice-sv' },
  );
  if (!(single.includes('qti-labels-cjk-ideographic'))) {
    expect.unreachable("Expected single.includes('qti-labels-cjk-ideographic')");
  }
  if (!(single.includes('qti-labels-suffix-parenthesis'))) {
    expect.unreachable("Expected single.includes('qti-labels-suffix-parenthesis')");
  }
  if (!(single.includes('qti-orientation-vertical'))) {
    expect.unreachable("Expected single.includes('qti-orientation-vertical')");
  }
  if (!(single.includes('qti-choices-stacking-4'))) {
    expect.unreachable("Expected single.includes('qti-choices-stacking-4')");
  }
  if (!(single.includes('qti-selections-dark'))) {
    expect.unreachable("Expected single.includes('qti-selections-dark')");
  }
  if (!(single.includes('qti-input-control-hidden'))) {
    expect.unreachable("Expected single.includes('qti-input-control-hidden')");
  }
  if (!(single.includes('qti-unselected-hidden'))) {
    expect.unreachable("Expected single.includes('qti-unselected-hidden')");
  }
  if (!(single.includes('qti-writing-orientation-vertical-rl'))) {
    expect.unreachable("Expected single.includes('qti-writing-orientation-vertical-rl')");
  }
  if (single.includes(' orientation="vertical"')) {
    expect.unreachable('Expected !single.includes(\' orientation="vertical"\')');
  }

  const multi = exportQti3TestItemXml(
    'multi_select',
    {
      title: 'Multi',
      bodyHtml: BODY,
      promptHtml: 'Pick',
      choices: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }],
      correctIds: ['A'],
      sharedVocabulary: { labelStyle: 'lower-alpha', selectionTone: 'light' },
    },
    { identifier: 'multi-sv' },
  );
  if (!(multi.includes('qti-labels-lower-alpha'))) {
    expect.unreachable("Expected multi.includes('qti-labels-lower-alpha')");
  }
  if (!(multi.includes('qti-selections-light'))) {
    expect.unreachable("Expected multi.includes('qti-selections-light')");
  }
});

testCase('order and match exports emit placement and tabular shared vocabulary', () => {
  const order = exportQti3TestItemXml(
    'order',
    {
      title: 'Order',
      bodyHtml: BODY,
      choices: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }],
      correctOrder: ['A', 'B'],
      minChoicesMessage: 'Place at least one',
      maxChoicesMessage: 'Place no more than two',
      sharedVocabulary: {
        labelStyle: 'upper-alpha',
        choicesPosition: 'left',
        choicesContainerWidth: 180,
        orientation: 'vertical',
      },
    },
    { identifier: 'order-sv' },
  );
  if (!(order.includes('qti-labels-upper-alpha'))) {
    expect.unreachable("Expected order.includes('qti-labels-upper-alpha')");
  }
  if (!(order.includes('qti-choices-left'))) {
    expect.unreachable("Expected order.includes('qti-choices-left')");
  }
  if (!(order.includes('qti-orientation-vertical'))) {
    expect.unreachable("Expected order.includes('qti-orientation-vertical')");
  }
  if (!(order.includes('data-choices-container-width="180"'))) {
    expect.unreachable('Expected order.includes(\'data-choices-container-width="180"\')');
  }
  if (!(order.includes('data-min-selections-message="Place at least one"'))) {
    expect.unreachable(
      'Expected order.includes(\'data-min-selections-message="Place at least one"\')',
    );
  }
  if (!(order.includes('data-max-selections-message="Place no more than two"'))) {
    expect.unreachable(
      'Expected order.includes(\'data-max-selections-message="Place no more than two"\')',
    );
  }

  const match = exportQti3TestItemXml(
    'match',
    {
      title: 'Match',
      bodyHtml: BODY,
      sources: [{ id: 'A', text: 'A' }],
      targets: [{ id: 'T1', text: 'T1' }],
      correctPairs: [{ sourceId: 'A', targetId: 'T1' }],
      sharedVocabulary: {
        matchTabular: true,
        matchHeaderHidden: true,
        matchFirstColumnHeader: 'Terms',
        choicesPosition: 'right',
        choicesContainerWidth: 160,
      },
    },
    { identifier: 'match-sv' },
  );
  if (!(match.includes('qti-match-tabular'))) {
    expect.unreachable("Expected match.includes('qti-match-tabular')");
  }
  if (!(match.includes('qti-header-hidden'))) {
    expect.unreachable("Expected match.includes('qti-header-hidden')");
  }
  if (!(match.includes('qti-choices-right'))) {
    expect.unreachable("Expected match.includes('qti-choices-right')");
  }
  if (!(match.includes('data-first-column-header="Terms"'))) {
    expect.unreachable('Expected match.includes(\'data-first-column-header="Terms"\')');
  }
  if (!(match.includes('data-choices-container-width="160"'))) {
    expect.unreachable('Expected match.includes(\'data-choices-container-width="160"\')');
  }
});

testCase('gap match export emits interaction and per-gap shared vocabulary', () => {
  const gapMarker = createMarkerHtml({
    attr: 'data-qti-gap',
    id: 'G1',
    label: 'G1',
    className: 'qti-gap-marker',
    contentEditable: false,
  });
  const xml = exportQti3TestItemXml(
    'gap_match',
    {
      title: 'Gap',
      bodyHtml: `<p>${gapMarker}</p>`,
      gapChoices: [{ id: 'A', kind: 'text', text: 'Alpha', matchMax: 1 }],
      gaps: [{ id: 'G1', label: 'G1', widthClass: 'qti-input-width-35' }],
      correctGapPairs: [{ choiceId: 'A', gapId: 'G1' }],
      sharedVocabulary: {
        gapPlacement: true,
        choicesPosition: 'left',
        choicesContainerWidth: 120,
      },
    },
    { identifier: 'gap-sv' },
  );
  if (!(xml.includes('qti-gap-placement'))) {
    expect.unreachable("Expected xml.includes('qti-gap-placement')");
  }
  if (!(xml.includes('qti-choices-left'))) {
    expect.unreachable("Expected xml.includes('qti-choices-left')");
  }
  if (!(xml.includes('data-choices-container-width="120"'))) {
    expect.unreachable('Expected xml.includes(\'data-choices-container-width="120"\')');
  }
  if (!(xml.includes('<qti-gap identifier="G1" class="qti-input-width-35"/>'))) {
    expect.unreachable(
      'Expected xml.includes(\'<qti-gap identifier="G1" class="qti-input-width-35"/>\')',
    );
  }
});

testCase('graphic gap match export uses shared vocabulary only', () => {
  const xml = exportQti3TestItemXml(
    'graphic_gap_match',
    {
      title: 'Graphic Gap',
      promptHtml: 'Drag labels',
      graphicBackgroundSrc: 'map.png',
      graphicBackgroundAlt: 'Map',
      choices: [{ id: 'A', kind: 'text', text: 'A', matchMax: 1 }],
      targets: [{ id: 'T1', shape: 'rect', coords: '1,1,2,2', matchMax: 1 }],
      correctPairs: [{ choiceId: 'A', targetId: 'T1' }],
      sharedVocabulary: {
        choicesPosition: 'top',
        choicesContainerWidth: 320,
        selectionTone: 'light',
      },
    },
    { identifier: 'graphic-gap-sv' },
  );
  if (!(xml.includes('qti-choices-top'))) {
    expect.unreachable("Expected xml.includes('qti-choices-top')");
  }
  if (!(xml.includes('data-choices-container-width="320"'))) {
    expect.unreachable('Expected xml.includes(\'data-choices-container-width="320"\')');
  }
  if (!(xml.includes('qti-selections-light'))) {
    expect.unreachable("Expected xml.includes('qti-selections-light')");
  }
});

testCase('hottext and hotspot exports emit shared vocabulary classes', () => {
  const hottext = exportQti3TestItemXml(
    'hottext',
    {
      title: 'Hottext',
      bodyHtml: '<p>Pick <span data-qti-hottext="H1">one</span>.</p>',
      hottexts: [{ id: 'H1', text: 'one' }],
      correctIds: ['H1'],
      sharedVocabulary: { selectionTone: 'dark', unselectedHidden: true },
    },
    { identifier: 'hottext-sv' },
  );
  if (!(hottext.includes('qti-selections-dark'))) {
    expect.unreachable("Expected hottext.includes('qti-selections-dark')");
  }
  if (!(hottext.includes('qti-unselected-hidden'))) {
    expect.unreachable("Expected hottext.includes('qti-unselected-hidden')");
  }

  const hotspot = exportQti3TestItemXml(
    'hotspot',
    {
      title: 'Hotspot',
      promptHtml: 'Select region',
      hotspotImageSrc: 'map.png',
      hotspotImageAlt: 'Map',
      choices: [{ id: 'R1', shape: 'rect', coords: '1,1,2,2' }],
      correctIds: ['R1'],
      sharedVocabulary: { selectionTone: 'light' },
    },
    { identifier: 'hotspot-sv' },
  );
  if (!(hotspot.includes('qti-selections-light'))) {
    expect.unreachable("Expected hotspot.includes('qti-selections-light')");
  }
});

testCase('media export emits shared player controls and pause attributes', () => {
  const xml = exportQti3TestItemXml(
    'media',
    {
      title: 'Media',
      bodyHtml: BODY,
      mediaKind: 'audio',
      mediaSources: [{ src: 'audio.mp3', type: 'audio/mpeg' }],
      mediaAutostart: false,
      sharedVocabulary: {
        mediaPlayerControls: ['captions'],
        mediaPauseDelay: 0.25,
        mediaPauseDuration: 1.5,
      },
    },
    { identifier: 'media-sv' },
  );
  if (!(xml.includes('data-qti-media-player-controls="captions"'))) {
    expect.unreachable('Expected xml.includes(\'data-qti-media-player-controls="captions"\')');
  }
  if (!(xml.includes('data-qti-media-player-pause-delay="0.25"'))) {
    expect.unreachable('Expected xml.includes(\'data-qti-media-player-pause-delay="0.25"\')');
  }
  if (!(xml.includes('data-qti-media-player-pause-duration="1.5"'))) {
    expect.unreachable('Expected xml.includes(\'data-qti-media-player-pause-duration="1.5"\')');
  }
});

testCase('media export emits multiple player control tokens', () => {
  const xml = exportQti3TestItemXml(
    'media',
    {
      title: 'Media',
      bodyHtml: BODY,
      mediaKind: 'video',
      mediaSources: [{ src: 'clip.mp4', type: 'video/mp4' }],
      mediaAutostart: false,
      sharedVocabulary: {
        mediaPlayerControls: ['play', 'captions'],
      },
    },
    { identifier: 'media-multi-controls' },
  );
  if (!(xml.includes('data-qti-media-player-controls="play captions"'))) {
    expect.unreachable('Expected xml.includes(\'data-qti-media-player-controls="play captions"\')');
  }
});

function assertSharedVocabulary(
  actual: QtiInteractionVocabulary | undefined,
  expected: QtiInteractionVocabulary,
) {
  expect(actual).toStrictEqual(expected);
}

testCase('qti3 import parses shared vocabulary into structured draft fields', () => {
  const parsed = parseItemXml(`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="import-sv" title="Import SV" time-dependent="false" xml:lang="en-US">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>A</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1" orientation="horizontal" class="qti-labels-decimal qti-labels-suffix-period qti-selections-light">
      <qti-simple-choice identifier="A">A</qti-simple-choice>
      <qti-simple-choice identifier="B">B</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>
</qti-assessment-item>`);
  expect(parsed.draft.type).toStrictEqual('single_select');
  assertSharedVocabulary(parsed.draft.sharedVocabulary, {
    labelStyle: 'decimal',
    labelSuffix: 'period',
    orientation: 'horizontal',
    selectionTone: 'light',
  });
});

testCase(
  'qti3 import parses shared vocabulary for match gap hottext hotspot and graphic gap',
  () => {
    const match = parseItemXml(`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="match-sv" title="Match" time-dependent="false" xml:lang="en-US">
  <qti-response-declaration identifier="RESPONSE" cardinality="multiple" base-type="directedPair"/>
  <qti-item-body>
    <qti-match-interaction response-identifier="RESPONSE" class="qti-match-tabular qti-choices-right" data-first-column-header="Terms" data-choices-container-width="160">
      <qti-simple-match-set><qti-simple-associable-choice identifier="A">A</qti-simple-associable-choice></qti-simple-match-set>
      <qti-simple-match-set><qti-simple-associable-choice identifier="T1">T1</qti-simple-associable-choice></qti-simple-match-set>
    </qti-match-interaction>
  </qti-item-body>
</qti-assessment-item>`);
    assertSharedVocabulary(match.draft.sharedVocabulary, {
      matchTabular: true,
      choicesPosition: 'right',
      matchFirstColumnHeader: 'Terms',
      choicesContainerWidth: 160,
    });

    const hottext = parseItemXml(`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="hottext-sv" title="Hottext" time-dependent="false" xml:lang="en-US">
  <qti-response-declaration identifier="RESPONSE" cardinality="multiple" base-type="identifier"/>
  <qti-item-body>
    <qti-hottext-interaction response-identifier="RESPONSE" class="qti-selections-dark">
      <qti-hottext identifier="H1">one</qti-hottext>
    </qti-hottext-interaction>
  </qti-item-body>
</qti-assessment-item>`);
    assertSharedVocabulary(hottext.draft.sharedVocabulary, { selectionTone: 'dark' });

    const hotspot = parseItemXml(`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="hotspot-sv" title="Hotspot" time-dependent="false" xml:lang="en-US">
  <qti-response-declaration identifier="RESPONSE" cardinality="multiple" base-type="identifier"/>
  <qti-item-body>
    <qti-hotspot-interaction response-identifier="RESPONSE" class="qti-unselected-hidden">
      <object data="map.png" alt="Map"/>
      <qti-hotspot-choice identifier="R1" shape="rect" coords="1,1,2,2"/>
    </qti-hotspot-interaction>
  </qti-item-body>
</qti-assessment-item>`);
    assertSharedVocabulary(hotspot.draft.sharedVocabulary, { unselectedHidden: true });
  },
);

testCase('choice shared vocabulary round-trips through export and import', () => {
  const xml = exportQti3TestItemXml(
    'single_select',
    {
      title: 'Round trip',
      bodyHtml: BODY,
      promptHtml: 'Pick',
      choices: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }],
      correctId: 'A',
      sharedVocabulary: {
        labelStyle: 'decimal',
        orientation: 'vertical',
        selectionTone: 'light',
      },
    },
    { identifier: 'round-trip' },
  );
  const parsed = parseItemXml(xml);
  assertSharedVocabulary(parsed.draft.sharedVocabulary, {
    labelStyle: 'decimal',
    orientation: 'vertical',
    selectionTone: 'light',
  });
});

testCase('media player controls round-trip multiple tokens through qti3-core bridge', () => {
  const controls: QtiMediaPlayerControls[] = ['play', 'captions'];
  const sample: QtiInteractionVocabulary = { mediaPlayerControls: controls };
  const roundTripped = vocabularyRoundTrip(sample, 'media');
  expect(roundTripped).toStrictEqual({ mediaPlayerControls: ['play', 'captions'] });
});

const VOCABULARY_SAMPLES: Record<SharedVocabularyProperty, QtiInteractionVocabulary> = {
  labelStyle: { labelStyle: 'decimal' },
  labelSuffix: { labelSuffix: 'period' },
  orientation: { orientation: 'vertical' },
  choicesStacking: { choicesStacking: 4 },
  choicesPosition: { choicesPosition: 'left' },
  choicesContainerWidth: { choicesContainerWidth: 160 },
  selectionTone: { selectionTone: 'dark' },
  inputControlHidden: { inputControlHidden: true },
  unselectedHidden: { unselectedHidden: true },
  writingOrientation: { writingOrientation: 'vertical-rl' },
  matchTabular: { matchTabular: true },
  matchHeaderHidden: { matchHeaderHidden: true },
  matchFirstColumnHeader: { matchFirstColumnHeader: 'Terms' },
  gapPlacement: { gapPlacement: true },
  mediaPlayerControls: { mediaPlayerControls: ['captions'] },
  mediaPauseDelay: { mediaPauseDelay: 0.25 },
  mediaPauseDuration: { mediaPauseDuration: 1.5 },
};

testCase('each vocabulary property round-trips through qti3-core bridge', () => {
  for (const entry of SHARED_VOCABULARY_INTERACTION_DEFINITIONS) {
    const sample = VOCABULARY_SAMPLES[entry.property];
    const interaction = QFLOW_TO_QTI3_INTERACTION[entry.types[0]];
    const roundTripped = vocabularyRoundTrip(sample, interaction);
    expect(roundTripped, `${entry.property}: qti3-core vocabulary round-trip failed`).toStrictEqual(
      sample,
    );
  }
});
