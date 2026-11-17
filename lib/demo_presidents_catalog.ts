import type { Draft } from './types/draft.ts';
import { newAuthoringItemLanguage } from './types/item_language.ts';
import type { TextEntrySlot } from './types/text_entry.ts';
import { createInlineChoiceMarkerHtml } from './types/inline_choice.ts';
import { createHottextMarkerHtml } from './types/hottext.ts';
import { createGapMarkerHtml } from './types/gap_match.ts';
import { exportQti3AssessmentItemXml } from './types/qti3_authoring.ts';
import { createPlaceholderHtml } from './text_entry_placeholders.ts';
import {
  type PrecomputedQuestionCompatibility,
  projectQuestionBankRevision,
} from './question_bank.ts';

/** Content version used to decide whether a workspace demo needs refreshing. */
export const DEMO_PRESIDENTS_VERSION = 'presidents-v8';

/** Tags applied to the assessment and every question in the presidents demo. */
export const DEMO_PRESIDENTS_DEFAULT_TAGS = ['demo', 'qti-example'] as const;

/** Static section definition for the presidents demo assessment. */
export type DemoPresidentPart = { readonly key: string; readonly title: string };

/** Ordered sections in the presidents demo assessment. */
export const DEMO_PRESIDENT_PARTS: readonly DemoPresidentPart[] = [
  { key: 'foundations', title: 'Foundations & Recall' },
  { key: 'relationships', title: 'Chronology & Connections' },
  { key: 'interactive', title: 'Interactive & Media' },
  { key: 'constructed', title: 'Constructed Response' },
];

/** One canonical question source in the presidents demo catalog. */
export type DemoPresidentSource = {
  readonly id: string;
  readonly title: string;
  readonly partKey: string;
  readonly type: NonNullable<Draft['type']>;
  readonly draft: Draft;
  readonly stableKey: string;
  readonly tags?: readonly string[];
};

// Catalog content is fixed; constructing it must not generate unused random answer identities.
const gettysburgSlot: TextEntrySlot = {
  id: 'ADDRESS_AUTHOR',
  label: 'President',
  base: 10,
  expectedLength: 20,
  widthClass: 'qti-input-width-10',
  responseBaseType: 'string',
  answers: [
    { id: '4d4f9207-7132-5cb6-9771-1ae6365f2585', value: 'Abraham Lincoln', score: 1 },
    { id: 'ffac91fc-3d8e-51c5-bbad-796688b2fb0d', value: 'Lincoln', score: 1 },
  ],
};
const gettysburgPlaceholder = createPlaceholderHtml({
  id: gettysburgSlot.id,
  label: gettysburgSlot.label,
  widthClass: gettysburgSlot.widthClass,
});

const firstsGap1 = createGapMarkerHtml({ id: 'GAP_1', label: 'Blank 1' });
const firstsGap2 = createGapMarkerHtml({ id: 'GAP_2', label: 'Blank 2' });

const presidentsTimelineSvg =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPSc0ODAnIGhlaWdodD0nMjYwJyB2aWV3Qm94PScwIDAgNDgwIDI2MCc+CiAgPHJlY3Qgd2lkdGg9JzQ4MCcgaGVpZ2h0PScyNjAnIGZpbGw9JyNmNGYyZWEnLz4KICA8cmVjdCB4PScyMCcgeT0nMjAnIHdpZHRoPSc0NDAnIGhlaWdodD0nMjIwJyByeD0nMTgnIGZpbGw9JyNmZmZmZmYnIHN0cm9rZT0nI2M5YzFiMScgc3Ryb2tlLXdpZHRoPScyJy8+CiAgPGxpbmUgeDE9JzgwJyB5MT0nMTMwJyB4Mj0nNDAwJyB5Mj0nMTMwJyBzdHJva2U9JyNiMDhkNTcnIHN0cm9rZS13aWR0aD0nNicvPgogIDxjaXJjbGUgY3g9JzEyMCcgY3k9JzEzMCcgcj0nMTgnIGZpbGw9JyMyZjQ4NTgnLz4KICA8Y2lyY2xlIGN4PScyNDAnIGN5PScxMzAnIHI9JzE4JyBmaWxsPScjMmY0ODU4Jy8+CiAgPGNpcmNsZSBjeD0nMzYwJyBjeT0nMTMwJyByPScxOCcgZmlsbD0nIzJmNDg1OCcvPgogIDx0ZXh0IHg9JzEyMCcgeT0nMTY1JyB0ZXh0LWFuY2hvcj0nbWlkZGxlJyBmb250LXNpemU9JzE0JyBmaWxsPScjMmY0ODU4JyBmb250LWZhbWlseT0nR2VvcmdpYSc+MTc4OTwvdGV4dD4KICA8dGV4dCB4PScyNDAnIHk9JzE2NScgdGV4dC1hbmNob3I9J21pZGRsZScgZm9udC1zaXplPScxNCcgZmlsbD0nIzJmNDg1OCcgZm9udC1mYW1pbHk9J0dlb3JnaWEnPjE4NjU8L3RleHQ+CiAgPHRleHQgeD0nMzYwJyB5PScxNjUnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZvbnQtc2l6ZT0nMTQnIGZpbGw9JyMyZjQ4NTgnIGZvbnQtZmFtaWx5PSdHZW9yZ2lhJz4xOTMzPC90ZXh0Pgo8L3N2Zz4=';
const presidentsMarkerSvg =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPSczMicgaGVpZ2h0PSczMicgdmlld0JveD0nMCAwIDMyIDMyJz4KICA8Y2lyY2xlIGN4PScxNicgY3k9JzE2JyByPScxNCcgZmlsbD0nI2IwNGEzZicvPgogIDxjaXJjbGUgY3g9JzE2JyBjeT0nMTYnIHI9JzYnIGZpbGw9JyNmZmY1ZTYnLz4KPC9zdmc+';
const presidentsTimelineAlt = 'Timeline graphic with three presidential eras marked.';

const inlineChoiceSlot1 = {
  id: 'INLINE_1',
  label: 'First President',
  required: true,
  shuffle: false,
  options: [
    { id: 'A', text: 'George Washington', score: 1 },
    { id: 'B', text: 'Thomas Jefferson', score: 0 },
    { id: 'C', text: 'James Madison', score: 0 },
  ],
  correctId: 'A',
};
const inlineChoiceSlot2 = {
  id: 'INLINE_2',
  label: 'Emancipation Proclamation',
  required: true,
  shuffle: false,
  options: [
    { id: 'A', text: 'Ulysses S. Grant', score: 0 },
    { id: 'B', text: 'Abraham Lincoln', score: 1 },
    { id: 'C', text: 'Andrew Johnson', score: 0 },
  ],
  correctId: 'B',
};
const inlineChoiceBody =
  `<p>The first President was ${
    createInlineChoiceMarkerHtml({ id: inlineChoiceSlot1.id, label: inlineChoiceSlot1.label })
  },` +
  ` and the Emancipation Proclamation was issued by ${
    createInlineChoiceMarkerHtml({ id: inlineChoiceSlot2.id, label: inlineChoiceSlot2.label })
  }.</p>`;

const hottextSpans = [
  { id: 'HT_A', text: 'George Washington' },
  { id: 'HT_B', text: 'Abraham Lincoln' },
  { id: 'HT_C', text: 'Franklin D. Roosevelt' },
];
const hottextMarkers = hottextSpans.map((span) =>
  createHottextMarkerHtml({ id: span.id, label: span.text })
);

/** Canonical, ordered question sources for the presidents demo. */
const DEMO_PRESIDENT_SOURCES_RAW: readonly (Omit<DemoPresidentSource, 'draft'> & {
  readonly draft: Omit<Draft, 'itemLanguage'>;
})[] = [
  {
    id: 'foundations-first-inauguration',
    title: 'Setting the Two-Term Tradition',
    partKey: 'foundations',
    type: 'single_select',
    stableKey: 'demo-presidents-1',
    tags: ['us-history', 'presidents'],
    draft: {
      type: 'single_select',
      title: 'Who set the precedent for serving only two terms as U.S. President?',
      promptHtml: 'Select the President whose leadership defined the peaceful transfer of power.',
      bodyHtml: '<p>This question focuses on the earliest years of the republic.</p>',
      choices: [
        { id: 'A', text: 'George Washington' },
        { id: 'B', text: 'John Adams' },
        { id: 'C', text: 'Thomas Jefferson' },
        { id: 'D', text: 'James Madison' },
      ],
      correctId: 'A',
      shuffle: true,
      required: true,
      minChoices: 1,
    },
  },
  {
    id: 'foundations-vice-presidents',
    title: 'Leaders with Vice Presidential Experience',
    partKey: 'foundations',
    type: 'multi_select',
    stableKey: 'demo-presidents-2',
    tags: ['us-history', 'presidents'],
    draft: {
      type: 'multi_select',
      title: 'Which future Presidents previously served as Vice President?',
      promptHtml:
        'Choose all Presidents who held the office of Vice President before becoming President.',
      bodyHtml: '<p>Early administrations often elevated vice presidents into the top role.</p>',
      choices: [
        { id: 'A', text: 'John Adams' },
        { id: 'B', text: 'Thomas Jefferson' },
        { id: 'C', text: 'James Madison' },
        { id: 'D', text: 'James Monroe' },
        { id: 'E', text: 'Martin Van Buren' },
      ],
      correctIds: ['A', 'B', 'E'],
      shuffle: true,
      minChoices: 1,
      maxChoices: 3,
      responseMode: 'partial',
    },
  },
  {
    id: 'foundations-inline-choice-firsts',
    title: 'Presidential Firsts (Inline Choices)',
    partKey: 'foundations',
    type: 'inline_choice',
    stableKey: 'demo-presidents-9',
    tags: ['us-history', 'presidents'],
    draft: {
      type: 'inline_choice',
      title: 'Fill in the missing Presidents.',
      promptHtml: 'Choose the correct President for each blank.',
      bodyHtml: inlineChoiceBody,
      inlineChoices: [inlineChoiceSlot1, inlineChoiceSlot2],
      responseMode: 'all_or_nothing',
    },
  },
  {
    id: 'foundations-hottext-civil-war',
    title: 'Civil War Leadership (Hot Text)',
    partKey: 'foundations',
    type: 'hottext',
    stableKey: 'demo-presidents-10',
    tags: ['us-history', 'presidents'],
    draft: {
      type: 'hottext',
      title: 'Select the President who served during the Civil War.',
      promptHtml: 'Tap the highlighted President from the 1860s.',
      bodyHtml: `<p>${hottextMarkers.join(' ')}</p>`,
      hottexts: hottextSpans,
      correctIds: ['HT_B'],
      responseIdentifier: 'RESPONSE',
      minChoices: 1,
      maxChoices: 1,
    },
  },
  {
    id: 'chronology-presidential-order',
    title: 'Ordering Key Administrations',
    partKey: 'relationships',
    type: 'order',
    stableKey: 'demo-presidents-3',
    tags: ['timeline', 'presidents'],
    draft: {
      type: 'order',
      title: 'Arrange these Presidents from earliest to latest service.',
      promptHtml: 'Drag to arrange the administrations chronologically.',
      bodyHtml:
        '<p>Consider how the nation evolved from the early republic through industrialization.</p>',
      choices: [
        { id: 'CHOICE_A', text: 'James Madison' },
        { id: 'CHOICE_B', text: 'Andrew Jackson' },
        { id: 'CHOICE_C', text: 'Abraham Lincoln' },
        { id: 'CHOICE_D', text: 'Theodore Roosevelt' },
      ],
      correctOrder: ['CHOICE_A', 'CHOICE_B', 'CHOICE_C', 'CHOICE_D'],
    },
  },
  {
    id: 'relationships-match-achievements',
    title: 'Match Presidents to Signature Actions',
    partKey: 'relationships',
    type: 'match',
    stableKey: 'demo-presidents-4',
    tags: ['policies', 'presidents'],
    draft: {
      type: 'match',
      title: 'Match each President to a signature achievement.',
      promptHtml:
        'Pair the leader with the milestone most closely associated with their administration.',
      bodyHtml: '<p>Each policy listed below transformed U.S. history.</p>',
      sources: [
        { id: 'SRC_A', text: 'George Washington', matchMax: 1 },
        { id: 'SRC_B', text: 'Abraham Lincoln', matchMax: 1 },
        { id: 'SRC_C', text: 'Franklin D. Roosevelt', matchMax: 1 },
      ],
      targets: [
        { id: 'TGT_A', text: 'Neutrality Proclamation' },
        { id: 'TGT_B', text: 'Emancipation Proclamation' },
        { id: 'TGT_C', text: 'First New Deal programs' },
      ],
      correctPairs: [
        { sourceId: 'SRC_A', targetId: 'TGT_A' },
        { sourceId: 'SRC_B', targetId: 'TGT_B' },
        { sourceId: 'SRC_C', targetId: 'TGT_C' },
      ],
      maxAssociations: 0,
    },
  },
  {
    id: 'relationships-associate-actions',
    title: 'Connect Presidents to Actions',
    partKey: 'relationships',
    type: 'associate',
    stableKey: 'demo-presidents-8',
    tags: ['policies', 'presidents'],
    draft: {
      type: 'associate',
      title: 'Pair each President with a signature action.',
      promptHtml: 'Draw a line between each President and the corresponding action.',
      bodyHtml: '<p>Each action should be used once.</p>',
      choices: [
        { id: 'A', text: 'George Washington', matchMax: 1 },
        { id: 'B', text: 'Two-term precedent', matchMax: 1 },
        { id: 'C', text: 'Abraham Lincoln', matchMax: 1 },
        { id: 'D', text: 'Emancipation Proclamation', matchMax: 1 },
      ],
      correctPairs: [
        { sourceId: 'A', targetId: 'B' },
        { sourceId: 'C', targetId: 'D' },
      ],
      shuffle: true,
      minAssociations: 2,
      maxAssociations: 2,
      responseIdentifier: 'RESPONSE',
    },
  },
  {
    id: 'relationships-slider-impact',
    title: 'Rate the New Deal Impact',
    partKey: 'relationships',
    type: 'slider',
    stableKey: 'demo-presidents-17',
    tags: ['civic-literacy', 'presidents'],
    draft: {
      type: 'slider',
      title: 'How impactful was the New Deal on American life?',
      promptHtml: 'Drag the slider to the best estimate.',
      bodyHtml: '<p>Choose a value from 0 (low impact) to 100 (high impact).</p>',
      responseIdentifier: 'RESPONSE',
      sliderLowerBound: 0,
      sliderUpperBound: 100,
      sliderStep: 10,
      sliderStepLabel: true,
      sliderOrientation: 'horizontal',
      sliderReverse: false,
      sliderCorrectValue: 80,
      sliderMappings: [{ mapKey: 80, mappedValue: 1 }],
    },
  },
  {
    id: 'relationships-gap-match-firsts',
    title: 'Presidential Firsts (Drag & Drop)',
    partKey: 'relationships',
    type: 'gap_match',
    stableKey: 'demo-presidents-7',
    tags: ['civic-literacy', 'presidents', 'drag-drop'],
    draft: {
      type: 'gap_match',
      title: 'Drag the correct President into each blank.',
      promptHtml:
        '<p>Use the choices to complete the statements about key moments in U.S. history.</p>',
      bodyHtml: `<p>The first President of the United States was ${firstsGap1}.</p>` +
        `<p>The President who issued the Emancipation Proclamation was ${firstsGap2}.</p>`,
      responseIdentifier: 'RESPONSE',
      shuffle: true,
      minAssociations: 2,
      maxAssociations: 2,
      minAssociationsMessage: 'Fill in both blanks before moving on.',
      maxAssociationsMessage: 'You have already filled both blanks.',
      gapChoices: [
        { id: 'A', kind: 'text', text: 'George Washington', matchMax: 1 },
        { id: 'B', kind: 'text', text: 'Abraham Lincoln', matchMax: 1 },
        { id: 'C', kind: 'text', text: 'Theodore Roosevelt', matchMax: 1 },
      ],
      gaps: [
        { id: 'GAP_1', label: 'Blank 1' },
        { id: 'GAP_2', label: 'Blank 2' },
      ],
      correctGapPairs: [
        { choiceId: 'A', gapId: 'GAP_1' },
        { choiceId: 'B', gapId: 'GAP_2' },
      ],
    },
  },
  {
    id: 'interactive-hotspot-era',
    title: 'Locate the Civil War Era',
    partKey: 'interactive',
    type: 'hotspot',
    stableKey: 'demo-presidents-11',
    tags: ['presidents', 'interactive'],
    draft: {
      type: 'hotspot',
      title: 'Select the hotspot for the 1860s.',
      promptHtml: 'Tap the era associated with the Civil War.',
      hotspotImageSrc: presidentsTimelineSvg,
      hotspotImageAlt: presidentsTimelineAlt,
      responseIdentifier: 'RESPONSE',
      minChoices: 1,
      maxChoices: 1,
      choices: [
        { id: 'A', shape: 'circle', coords: '120,130,22' },
        { id: 'B', shape: 'circle', coords: '240,130,22' },
        { id: 'C', shape: 'circle', coords: '360,130,22' },
      ],
      correctIds: ['B'],
    },
  },
  {
    id: 'interactive-graphic-gap-match',
    title: 'Drag Presidents onto the Timeline',
    partKey: 'interactive',
    type: 'graphic_gap_match',
    stableKey: 'demo-presidents-12',
    tags: ['presidents', 'interactive', 'drag-drop'],
    draft: {
      type: 'graphic_gap_match',
      title: 'Match each President to the correct era on the timeline.',
      promptHtml: 'Drag each name to the correct circle.',
      graphicBackgroundSrc: presidentsTimelineSvg,
      graphicBackgroundAlt: presidentsTimelineAlt,
      graphicBackgroundLongDesc: '',
      responseIdentifier: 'RESPONSE',
      choices: [
        { id: 'A', kind: 'text', text: 'George Washington', matchMax: 1 },
        { id: 'B', kind: 'text', text: 'Abraham Lincoln', matchMax: 1 },
        { id: 'C', kind: 'text', text: 'Franklin D. Roosevelt', matchMax: 1 },
      ],
      targets: [
        { id: 'T1', shape: 'circle', coords: '120,130,22', matchMax: 1 },
        { id: 'T2', shape: 'circle', coords: '240,130,22', matchMax: 1 },
        { id: 'T3', shape: 'circle', coords: '360,130,22', matchMax: 1 },
      ],
      correctPairs: [
        { choiceId: 'A', targetId: 'T1' },
        { choiceId: 'B', targetId: 'T2' },
        { choiceId: 'C', targetId: 'T3' },
      ],
      sharedVocabulary: {
        choicesContainerWidth: 360,
      },
      minAssociations: 3,
      maxAssociations: 3,
      minAssociationsMessage: 'Place all three labels before continuing.',
      maxAssociationsMessage: 'All labels are already placed.',
    },
  },
  {
    id: 'interactive-graphic-associate',
    title: 'Connect Eras (Graphic Associate)',
    partKey: 'interactive',
    type: 'graphic_associate',
    stableKey: 'demo-presidents-13',
    tags: ['presidents', 'interactive'],
    draft: {
      type: 'graphic_associate',
      title: 'Pair the related eras on the timeline.',
      promptHtml: 'Draw lines to connect the matching era markers.',
      bodyHtml: '<p>Connect the top and bottom dots for each era.</p>',
      responseIdentifier: 'RESPONSE',
      graphicAssociateBackgroundSrc: presidentsTimelineSvg,
      graphicAssociateBackgroundAlt: presidentsTimelineAlt,
      graphicAssociateBackgroundLongDesc: '',
      graphicAssociateHotspots: [
        { id: 'A', shape: 'circle', coords: '120,90,18', matchMax: 1 },
        { id: 'B', shape: 'circle', coords: '120,170,18', matchMax: 1 },
        { id: 'C', shape: 'circle', coords: '360,90,18', matchMax: 1 },
        { id: 'D', shape: 'circle', coords: '360,170,18', matchMax: 1 },
      ],
      graphicAssociateCorrectPairs: [
        { sourceId: 'A', targetId: 'B' },
        { sourceId: 'C', targetId: 'D' },
      ],
      minAssociations: 2,
      maxAssociations: 2,
    },
  },
  {
    id: 'interactive-graphic-order',
    title: 'Order the Eras (Graphic Order)',
    partKey: 'interactive',
    type: 'graphic_order',
    stableKey: 'demo-presidents-14',
    tags: ['presidents', 'interactive'],
    draft: {
      type: 'graphic_order',
      title: 'Order the eras from earliest to latest.',
      promptHtml: 'Select the circles in chronological order.',
      bodyHtml: '<p>Follow the timeline from left to right.</p>',
      responseIdentifier: 'RESPONSE',
      graphicOrderBackgroundSrc: presidentsTimelineSvg,
      graphicOrderBackgroundAlt: presidentsTimelineAlt,
      graphicOrderBackgroundLongDesc: '',
      graphicOrderHotspots: [
        { id: 'A', shape: 'circle', coords: '120,130,22', label: '1789' },
        { id: 'B', shape: 'circle', coords: '240,130,22', label: '1865' },
        { id: 'C', shape: 'circle', coords: '360,130,22', label: '1933' },
      ],
      graphicOrderCorrectOrder: ['A', 'B', 'C'],
      minChoices: 3,
      maxChoices: 3,
    },
  },
  {
    id: 'interactive-position-object',
    title: 'Place the Marker (Position Object)',
    partKey: 'interactive',
    type: 'position_object',
    stableKey: 'demo-presidents-15',
    tags: ['presidents', 'interactive'],
    draft: {
      type: 'position_object',
      title: 'Drag the marker to the Civil War era.',
      promptHtml: '<p>Move the marker to the 1860s position.</p>',
      bodyHtml: '<p>Use the timeline to guide your placement.</p>',
      responseIdentifier: 'RESPONSE',
      positionStageSrc: presidentsTimelineSvg,
      positionStageAlt: presidentsTimelineAlt,
      positionStageWidth: 480,
      positionStageHeight: 260,
      positionObjectSrc: presidentsMarkerSvg,
      positionObjectAlt: 'Marker',
      positionObjectWidth: 32,
      positionObjectHeight: 32,
      positionTargets: [{ shape: 'circle', coords: '240,130,24', mappedValue: 1 }],
      positionCorrectPoints: ['240 130'],
      minChoices: 0,
      maxChoices: 1,
    },
  },
  {
    id: 'interactive-select-point',
    title: 'Select the New Deal Era (Select Point)',
    partKey: 'interactive',
    type: 'select_point',
    stableKey: 'demo-presidents-16',
    tags: ['presidents', 'interactive'],
    draft: {
      type: 'select_point',
      title: 'Click the era for the New Deal.',
      promptHtml: 'Select the hotspot for the 1930s.',
      bodyHtml: '<p>Click the correct point on the timeline.</p>',
      responseIdentifier: 'RESPONSE',
      selectPointImageSrc: presidentsTimelineSvg,
      selectPointImageAlt: presidentsTimelineAlt,
      selectPointImageWidth: 480,
      selectPointImageHeight: 260,
      selectPointTargets: [{ shape: 'circle', coords: '360,130,24', mappedValue: 1 }],
      selectPointCorrectPoints: ['360 130'],
      minChoices: 0,
      maxChoices: 1,
    },
  },
  {
    id: 'interactive-media',
    title: 'Presidential Timeline (Media)',
    partKey: 'interactive',
    type: 'media',
    stableKey: 'demo-presidents-18',
    tags: ['presidents', 'interactive', 'media'],
    draft: {
      type: 'media',
      title: 'Review the timeline.',
      promptHtml: 'Open the media object for the timeline.',
      bodyHtml: '<p>Use the timeline as a visual reference.</p>',
      responseIdentifier: 'RESPONSE',
      mediaKind: 'object',
      mediaSources: [{ src: presidentsTimelineSvg, type: 'image/svg+xml' }],
      mediaObjectLabel: 'Presidential timeline',
      mediaInteractionLabel: 'Timeline reference',
      mediaAutostart: false,
      mediaLoop: false,
      mediaMinPlays: 0,
      mediaMaxPlays: 0,
      mediaWidth: 480,
      mediaHeight: 260,
    },
  },
  {
    id: 'interactive-portable-custom',
    title: 'Portable Custom Timeline',
    partKey: 'interactive',
    type: 'portable_custom',
    stableKey: 'demo-presidents-21',
    tags: ['presidents', 'interactive', 'advanced'],
    draft: {
      type: 'portable_custom',
      title: 'Custom Interaction: Presidential Timeline',
      promptHtml: 'This portable custom interaction represents a timeline widget.',
      bodyHtml: '<p>Use the custom widget to explore the eras.</p>',
      responseIdentifier: 'RESPONSE',
      portableCustomTypeIdentifier: 'urn:qflow:presidents:timeline',
      portableModule: 'presidentsPci',
      portableBaseType: 'string',
      portableCardinality: 'single',
      portableInteractionMarkup:
        '<div class="pci-root">Arrange the three eras in order: 1789, 1865, 1933.</div>',
      portableDataAttributes: [
        { name: 'data-topic', value: 'presidents' },
        { name: 'data-mode', value: 'timeline' },
      ],
      portableInteractionModules: [],
      portableModulesPrimaryConfiguration: '',
      portableModulesSecondaryConfiguration: '',
    },
  },
  {
    id: 'constructed-gettysburg-address',
    title: 'Gettysburg Address Speaker',
    partKey: 'constructed',
    type: 'text_entry',
    stableKey: 'demo-presidents-5',
    tags: ['civic-literacy', 'presidents'],
    draft: {
      type: 'text_entry',
      title: 'Who delivered the Gettysburg Address?',
      promptHtml: 'Type the President’s name to complete the statement.',
      bodyHtml:
        `<p>The Gettysburg Address was delivered by ${gettysburgPlaceholder} on November 19, 1863.</p>`,
      textEntries: [gettysburgSlot],
    },
  },
  {
    id: 'constructed-fdr-inaugural',
    title: 'FDR Reassures the Nation',
    partKey: 'constructed',
    type: 'extended_text',
    stableKey: 'demo-presidents-6',
    tags: ['civic-literacy', 'presidents', 'writing'],
    draft: {
      type: 'extended_text',
      title: 'How did FDR reassure Americans in March 1933?',
      promptHtml:
        "Write 2-3 sentences describing how President Roosevelt's first inaugural address aimed to calm the nation.",
      bodyHtml:
        '<p>On March 4, 1933, Franklin D. Roosevelt addressed a nation facing bank failures and massive unemployment.</p><p>Mention at least two concrete ideas or phrases he used to restore public confidence.</p>',
      responseIdentifier: 'RESPONSE',
      expectedLength: 250,
      expectedLines: 8,
      minStrings: 1,
      maxStrings: 1,
      placeholderText: 'Explain how FDR reassured Americans...',
      format: 'plain',
      heightClass: 'qti-height-lines-15',
      counterType: 'down',
      rubricHtml:
        '<p><strong>Scoring guidance</strong></p><ul><li>3 pts: cites at least two ideas ("fear itself", bank holiday, shared sacrifice) with explanation.</li><li>2 pts: references one idea with some detail.</li><li>1 pt: vague reassurance without specifics.</li></ul>',
    },
  },
  {
    id: 'constructed-upload-reflection',
    title: 'Upload a Presidential Reflection',
    partKey: 'constructed',
    type: 'upload',
    stableKey: 'demo-presidents-19',
    tags: ['presidents', 'writing'],
    draft: {
      type: 'upload',
      title: 'Upload a one-page reflection on a President.',
      promptHtml: 'Submit a PDF or DOCX file.',
      bodyHtml: '<p>Write a short reflection about a President and upload it as a PDF or DOCX.</p>',
      responseIdentifier: 'RESPONSE',
      uploadMaxFileSize: 5_000_000,
      uploadFileTypes: '.pdf,.docx',
      uploadMultiple: false,
      uploadClassName: '',
    },
  },
  {
    id: 'constructed-drawing-annotation',
    title: 'Annotate the Timeline',
    partKey: 'constructed',
    type: 'drawing',
    stableKey: 'demo-presidents-20',
    tags: ['presidents', 'interactive', 'drawing'],
    draft: {
      type: 'drawing',
      title: 'Annotate the timeline with key events.',
      promptHtml: 'Draw or highlight the era associated with the New Deal.',
      bodyHtml: '<p>Use the drawing tools to mark the timeline.</p>',
      responseIdentifier: 'RESPONSE',
      drawingImageSrc: presidentsTimelineSvg,
      drawingImageAlt: presidentsTimelineAlt,
      drawingImageWidth: 480,
      drawingImageHeight: 260,
    },
  },
];

/** Add the explicit new-content language policy at the demo catalog construction boundary. */
export const DEMO_PRESIDENT_SOURCES: readonly DemoPresidentSource[] = DEMO_PRESIDENT_SOURCES_RAW
  .map((source) => ({
    ...source,
    draft: { itemLanguage: newAuthoringItemLanguage(), ...source.draft },
  }));

/** Demo assessment copy derived from the canonical catalog size. */
export const DEMO_PRESIDENTS_ASSESSMENT_BRIEF =
  `${DEMO_PRESIDENT_SOURCES.length} checks spanning civics, chronology, and core question types.`;

/** Project one static source into the immutable content persisted by the demo seed workflow. */
export function createDemoPresidentRevisionContent(source: DemoPresidentSource) {
  const tags = Array.from(
    new Set([...DEMO_PRESIDENTS_DEFAULT_TAGS, ...(source.tags ?? [])]),
  );
  const draft: Draft = { ...source.draft, tags };
  return {
    stableKey: source.stableKey,
    title: draft.title ?? source.title,
    tags,
    body: draft as Record<string, unknown>,
    metadata: { source: 'demo', sourceLabel: source.title, topic: 'presidents' },
    qtiXml: exportXmlForDraft(source, source.id),
    note: `${source.title} (demo seed)`,
    draftState: 'published' as const,
  };
}

/** Computes the generated compatibility fixture from the canonical demo sources. */
export async function projectDemoCompatibilityFixture(): Promise<
  Readonly<Record<string, PrecomputedQuestionCompatibility>>
> {
  const entries = await Promise.all(DEMO_PRESIDENT_SOURCES.map(async (source) => {
    const input = createDemoPresidentRevisionContent(source);
    const projection = await projectQuestionBankRevision(input.title, input.body, input.qtiXml);
    return [source.stableKey, {
      contentHash: projection.contentHash,
      compatibility: projection.compatibility,
    }] as const;
  }));
  return Object.fromEntries(entries);
}

function exportXmlForDraft(source: DemoPresidentSource, identifier: string): string {
  const draft = { ...source.draft, type: source.type, title: source.draft.title ?? source.title };
  const required = typeof draft.required === 'boolean' ? draft.required : undefined;
  return exportQti3AssessmentItemXml(source.type, draft, {
    identifier,
    scoring: draft.responseMode === 'partial' ? 'map_response' : 'match_correct',
    required,
    minChoices: typeof draft.minChoices === 'number' ? draft.minChoices : undefined,
    maxChoices: typeof draft.maxChoices === 'number' ? draft.maxChoices : undefined,
    answerMasking: Boolean(draft.answerMasking),
    sharedVocabulary: draft.sharedVocabulary,
  });
}
