import { expect, test as testCase } from 'vitest';

import { normalizeDraftForDriver } from '../lib/types/draft_utils.ts';
import { QUESTION_TYPE_IDS, type QuestionTypeId, TYPE_DRIVERS } from '../lib/types/registry.ts';
import type { Draft } from '../lib/types/draft.ts';
import { createPlaceholderHtml } from '../lib/text_entry_placeholders.ts';
import { createInlineChoiceMarkerHtml } from '../lib/types/inline_choice.ts';
import { createHottextMarkerHtml } from '../lib/types/hottext.ts';
import { createGapMarkerHtml } from '../lib/types/gap_match.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

const fixtures: Record<QuestionTypeId, Draft> = {
  single_select: {
    type: 'single_select',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Single',
    promptHtml: '<p>Pick one option.</p>',
    bodyHtml: '<p>Single select body.</p>',
    choices: [
      { id: 'A', text: 'Alpha', label: 'A' },
      { id: 'B', html: '<strong>Bravo</strong>', fixed: true, label: 'B' },
      { id: 'C', text: 'Charlie' },
    ],
    correctId: 'B',
    shuffle: true,
    minChoices: 1,
    required: true,
    answerMasking: true,
    sharedVocabulary: {
      labelStyle: 'decimal',
      choicesStacking: 2,
      selectionTone: 'dark',
    },
  },
  multi_select: {
    type: 'multi_select',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Multi',
    promptHtml: '<p>Select all that apply.</p>',
    bodyHtml: '<p>Multi select body.</p>',
    choices: [
      { id: 'A', text: 'Option A' },
      { id: 'B', text: 'Option B' },
      { id: 'C', html: '<em>Option C</em>', fixed: true },
    ],
    correctIds: ['A', 'C'],
    minChoices: 1,
    maxChoices: 2,
    shuffle: true,
    answerMasking: true,
    sharedVocabulary: {
      labelStyle: 'upper-alpha',
      choicesStacking: 1,
      selectionTone: 'light',
    },
  },
  text_entry: {
    type: 'text_entry',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Text Entry',
    promptHtml: '<p>Fill the blanks.</p>',
    bodyHtml: (() => {
      const first = createPlaceholderHtml({ id: 'BLANK_1', label: 'ID' });
      const second = createPlaceholderHtml({ id: 'BLANK_2', label: 'Word' });
      return `<p>${first} then ${second}.</p>`;
    })(),
    textEntries: [
      {
        id: 'BLANK_1',
        label: 'ID',
        expectedLength: 4,
        widthClass: 'qti-input-width-4',
        patternMask: '^[0-9]{4}$',
        patternMessage: 'Use four digits.',
        answers: [{ id: 'A1', value: '1234', score: 1 }],
      },
      {
        id: 'BLANK_2',
        label: 'Word',
        expectedLength: 5,
        widthClass: 'qti-input-width-6',
        patternMask: '^.{5}$',
        patternMessage: 'Use five characters.',
        answers: [{ id: 'A2', value: 'alpha', score: 1, caseSensitive: true }],
      },
    ],
    requirePattern: true,
  },
  order: {
    type: 'order',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Order',
    promptHtml: '<p>Order the steps.</p>',
    bodyHtml: '<p>Ordering body.</p>',
    choices: [
      { id: 'A', text: 'Step 1' },
      { id: 'B', text: 'Step 2' },
      { id: 'C', text: 'Step 3' },
    ],
    correctOrder: ['B', 'A', 'C'],
  },
  match: {
    type: 'match',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Match',
    promptHtml: '<p>Match sources to targets.</p>',
    bodyHtml: '<p>Matching body.</p>',
    sources: [
      { id: 'A', text: 'Source A', matchMax: 1 },
      { id: 'B', text: 'Source B', matchMax: 2 },
    ],
    targets: [
      { id: 'T1', text: 'Target 1', matchMax: 1 },
      { id: 'T2', text: 'Target 2', matchMax: 1 },
    ],
    correctPairs: [{ sourceId: 'A', targetId: 'T1' }],
    minAssociations: 0,
    maxAssociations: 2,
  },
  associate: {
    type: 'associate',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Associate',
    promptHtml: '<p>Associate the items.</p>',
    bodyHtml: '<p>Associate body.</p>',
    choices: [
      { id: 'A', text: 'Left A', matchMax: 2 },
      { id: 'B', text: 'Left B', matchMax: 2 },
      { id: 'C', text: 'Left C', matchMax: 2 },
    ],
    correctPairs: [
      { sourceId: 'A', targetId: 'B' },
      { sourceId: 'B', targetId: 'C' },
    ],
    shuffle: true,
    minAssociations: 0,
    maxAssociations: 3,
    responseIdentifier: 'RESPONSE',
  },
  inline_choice: {
    type: 'inline_choice',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Inline Choice',
    promptHtml: '<p>Fill the blanks.</p>',
    bodyHtml: (() => {
      const marker = createInlineChoiceMarkerHtml({ id: 'RESPONSE_1', label: 'Blank 1' });
      return `<p>Choose ${marker} to complete the statement.</p>`;
    })(),
    inlineChoices: [
      {
        id: 'RESPONSE_1',
        label: 'Blank 1',
        required: true,
        shuffle: true,
        options: [
          { id: 'A', text: 'Alpha', score: 0 },
          { id: 'B', text: 'Bravo', score: 1, fixed: true },
          { id: 'C', html: '<em>Charlie</em>', score: 0 },
        ],
        correctId: 'B',
      },
    ],
    responseMode: 'partial',
  },
  extended_text: {
    type: 'extended_text',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Extended Text',
    promptHtml: '<p>Explain your thinking.</p>',
    bodyHtml: '<p>Extended text body.</p>',
    responseIdentifier: 'RESPONSE',
    stringIdentifier: 'STRING_1',
    expectedLength: 120,
    expectedLines: 4,
    minStrings: 1,
    maxStrings: 2,
    placeholderText: 'Write here...',
    format: 'xhtml',
    patternMask: '^[A-Za-z0-9 ]+$',
    patternMessage: 'Letters and numbers only.',
    heightClass: 'qti-height-lines-6',
    counterType: 'up',
    rubricHtml: '<p>Rubric notes.</p>',
  },
  gap_match: {
    type: 'gap_match',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Gap Match',
    promptHtml: '<p>Fill the gaps.</p>',
    bodyHtml: (() => {
      const gapA = createGapMarkerHtml({ id: 'GAP_A', label: 'Gap A' });
      const gapB = createGapMarkerHtml({ id: 'GAP_B', label: 'Gap B' });
      return `<p>${gapA} and ${gapB}.</p>`;
    })(),
    responseIdentifier: 'RESPONSE',
    shuffle: true,
    minAssociations: 1,
    maxAssociations: 2,
    minAssociationsMessage: 'Pick at least one.',
    maxAssociationsMessage: 'Too many.',
    gapChoices: [
      { id: 'A', kind: 'text', text: 'Alpha', matchMax: 1, fixed: true },
      { id: 'B', kind: 'image', imgSrc: 'choice-b.png', imgAlt: 'Choice B', matchMax: 2 },
    ],
    gaps: [
      { id: 'GAP_A', label: 'Gap A' },
      { id: 'GAP_B', label: 'Gap B' },
    ],
    correctGapPairs: [
      { choiceId: 'A', gapId: 'GAP_A' },
      { choiceId: 'B', gapId: 'GAP_B' },
    ],
  },
  graphic_gap_match: {
    type: 'graphic_gap_match',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Graphic Gap',
    promptHtml: '<p>Drag labels to the image.</p>',
    responseIdentifier: 'RESPONSE',
    graphicBackgroundSrc: 'background.png',
    graphicBackgroundAlt: 'Background',
    sharedVocabulary: {
      choicesPosition: 'top',
      choicesContainerWidth: 320,
    },
    minAssociations: 1,
    maxAssociations: 2,
    minAssociationsMessage: 'Minimum 1.',
    maxAssociationsMessage: 'Maximum 2.',
    choices: [
      { id: 'A', kind: 'text', text: 'Label A', matchMax: 1 },
      { id: 'B', kind: 'image', imgSrc: 'choice-b.png', imgAlt: 'Choice B', matchMax: 1 },
    ],
    targets: [
      { id: 'T1', shape: 'rect', coords: '10,10,100,50', matchMax: 1 },
      { id: 'T2', shape: 'circle', coords: '150,60,20', matchMax: 1 },
    ],
    correctPairs: [
      { choiceId: 'A', targetId: 'T1' },
      { choiceId: 'B', targetId: 'T2' },
    ],
  },
  graphic_associate: {
    type: 'graphic_associate',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Graphic Associate',
    promptHtml: '<p>Connect the hotspots.</p>',
    bodyHtml: '<p>Graphic associate body.</p>',
    responseIdentifier: 'RESPONSE',
    graphicAssociateBackgroundSrc: 'map.png',
    graphicAssociateBackgroundAlt: 'Map',
    graphicAssociateBackgroundType: 'image/png',
    graphicAssociateBackgroundWidth: 640,
    graphicAssociateBackgroundHeight: 480,
    graphicAssociateHotspots: [
      { id: 'A', shape: 'circle', coords: '50,50,10', matchMax: 2 },
      { id: 'B', shape: 'circle', coords: '150,50,10', matchMax: 2 },
      { id: 'C', shape: 'rect', coords: '50,100,120,140', matchMax: 2 },
    ],
    graphicAssociateCorrectPairs: [
      { sourceId: 'A', targetId: 'B' },
      { sourceId: 'B', targetId: 'C' },
    ],
    minAssociations: 0,
    maxAssociations: 3,
  },
  graphic_order: {
    type: 'graphic_order',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Graphic Order',
    promptHtml: '<p>Order the hotspots.</p>',
    bodyHtml: '<p>Graphic order body.</p>',
    responseIdentifier: 'RESPONSE',
    graphicOrderBackgroundSrc: 'map.png',
    graphicOrderBackgroundAlt: 'Map',
    graphicOrderBackgroundType: 'image/png',
    graphicOrderBackgroundWidth: 640,
    graphicOrderBackgroundHeight: 480,
    graphicOrderHotspots: [
      { id: 'A', shape: 'circle', coords: '50,50,10', label: 'First' },
      { id: 'B', shape: 'circle', coords: '150,50,10', label: 'Second' },
      { id: 'C', shape: 'circle', coords: '250,50,10', label: 'Third' },
    ],
    graphicOrderCorrectOrder: ['A', 'B', 'C'],
    minChoices: 1,
    maxChoices: 3,
  },
  media: {
    type: 'media',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Media',
    promptHtml: '<p>Play the clip.</p>',
    bodyHtml: '<p>Media body.</p>',
    responseIdentifier: 'RESPONSE',
    mediaKind: 'video',
    mediaSources: [
      { src: 'media.mp4', type: 'video/mp4' },
      { src: 'media.webm', type: 'video/webm' },
    ],
    mediaInteractionLabel: 'mediaButton',
    mediaAutostart: true,
    mediaLoop: false,
    mediaMinPlays: 1,
    mediaMaxPlays: 3,
    mediaCoords: '10,10,200,120',
    mediaWidth: 640,
    mediaHeight: 360,
  },
  portable_custom: {
    type: 'portable_custom',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture PCI',
    promptHtml: '<p>Use the custom widget.</p>',
    bodyHtml: '<p>PCI body.</p>',
    responseIdentifier: 'RESPONSE',
    portableCustomTypeIdentifier: 'urn:example:pci:widget',
    portableModule: 'pciModule',
    portableClassName: 'pci-class',
    portableLabel: 'PCI label',
    portableBaseType: 'string',
    portableCardinality: 'single',
    portableInteractionMarkup: '<div class="pci-root">Markup</div>',
    portableDataAttributes: [
      { name: 'data-mode', value: 'demo' },
      { name: 'data-size', value: 'large' },
    ],
    portableInteractionModules: [
      { id: 'lib1', primaryPath: 'modules/lib1.js', fallbackPath: 'modules/lib1-fallback.js' },
    ],
    portableModulesPrimaryConfiguration: 'modules/module_resolution.js',
    portableModulesSecondaryConfiguration: 'modules/fallback_module_resolution.js',
  },
  position_object: {
    type: 'position_object',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Position Object',
    promptHtml: '<p>Drag the marker to the correct location.</p>',
    bodyHtml: '<p>Position object body.</p>',
    responseIdentifier: 'RESPONSE',
    positionStageSrc: 'images/stage.png',
    positionStageAlt: 'Stage',
    positionStageType: 'image/png',
    positionStageWidth: 320,
    positionStageHeight: 240,
    positionObjectSrc: 'images/marker.png',
    positionObjectAlt: 'Marker',
    positionObjectType: 'image/png',
    positionObjectWidth: 16,
    positionObjectHeight: 16,
    positionCenterPoint: '118 184',
    positionTargets: [
      { shape: 'circle', coords: '118,184,12', mappedValue: 1 },
      { shape: 'rect', coords: '150,235,20,20', mappedValue: 2 },
    ],
    positionCorrectPoints: ['118 184', '150 235'],
    minChoices: 0,
    maxChoices: 2,
  },
  select_point: {
    type: 'select_point',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Select Point',
    promptHtml: '<p>Click the correct spot.</p>',
    bodyHtml: '<p>Select the point on the map.</p>',
    responseIdentifier: 'RESPONSE',
    selectPointImageSrc: 'images/map.png',
    selectPointImageAlt: 'Map image',
    selectPointImageWidth: 320,
    selectPointImageHeight: 240,
    selectPointTargets: [
      { shape: 'circle', coords: '118,184,12', mappedValue: 1 },
      { shape: 'rect', coords: '150,235,20,20', mappedValue: 2 },
    ],
    selectPointCorrectPoints: ['118 184', '150 235'],
    minChoices: 0,
    maxChoices: 2,
  },
  slider: {
    type: 'slider',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Slider',
    promptHtml: '<p>Move the slider.</p>',
    bodyHtml: '<p>Choose the best estimate.</p>',
    responseIdentifier: 'RESPONSE',
    sliderLowerBound: 0,
    sliderUpperBound: 100,
    sliderStep: 10,
    sliderStepLabel: false,
    sliderOrientation: 'horizontal',
    sliderReverse: false,
    sliderCorrectValue: 70,
    sliderMappings: [
      { mapKey: 60, mappedValue: 0.5 },
      { mapKey: 70, mappedValue: 1 },
    ],
  },
  upload: {
    type: 'upload',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Upload',
    promptHtml: '<p>Upload the requested file.</p>',
    bodyHtml: '<p>Provide the document outlined in the prompt.</p>',
    responseIdentifier: 'RESPONSE',
    uploadMaxFileSize: 1048576,
    uploadFileTypes: '.pdf,.xlsx',
    uploadMultiple: true,
  },
  hotspot: {
    type: 'hotspot',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Hotspot',
    promptHtml: '<p>Click the correct region.</p>',
    hotspotImageSrc: 'diagram.png',
    hotspotImageAlt: 'Diagram',
    responseIdentifier: 'RESPONSE',
    maxChoices: 2,
    minChoices: 1,
    minChoicesMessage: 'Pick at least one.',
    maxChoicesMessage: 'No more than two.',
    choices: [
      { id: 'A', shape: 'circle', coords: '20,20,10' },
      { id: 'B', shape: 'rect', coords: '40,40,80,80' },
    ],
    correctIds: ['A'],
  },
  hottext: {
    type: 'hottext',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Hottext',
    promptHtml: '<p>Select the incorrect phrase.</p>',
    bodyHtml: (() => {
      const hotA = createHottextMarkerHtml({ id: 'A', label: 'first' });
      const hotB = createHottextMarkerHtml({ id: 'B', label: 'second' });
      return `<p>${hotA} ${hotB}.</p>`;
    })(),
    hottexts: [
      { id: 'A', text: 'first' },
      { id: 'B', text: 'second' },
    ],
    correctIds: ['B'],
    responseIdentifier: 'RESPONSE',
    maxChoices: 1,
    minChoices: 0,
    minChoicesMessage: 'Pick at least one.',
    maxChoicesMessage: 'Too many selections.',
  },
  custom_interaction: {
    type: 'custom_interaction',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Custom',
    promptHtml: '<p>Custom instruction.</p>',
    bodyHtml: '<p>Custom body.</p>',
    responseIdentifier: 'CUSTOM_RESPONSE',
    customBaseType: 'string',
    customCardinality: 'ordered',
    customClassName: 'customWidget',
    customDefinition: 'https://example.com/custom',
    customAttributes: [
      { name: 'data-mode', value: 'advanced' },
      { name: 'aria-label', value: 'Custom widget' },
    ],
    customInteractionMarkup: '<div class="custom-interaction">Markup</div>',
    customResponseProcessingXml:
      '<qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>',
  },
  drawing: {
    type: 'drawing',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture Drawing',
    promptHtml: '<p>Draw on the image.</p>',
    bodyHtml: '<p>Drawing body.</p>',
    responseIdentifier: 'RESPONSE',
    drawingImageSrc: 'drawing.png',
    drawingImageAlt: 'Drawing surface',
    drawingImageType: 'image/png',
    drawingImageWidth: 640,
    drawingImageHeight: 480,
  },
  end_attempt: {
    type: 'end_attempt',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Fixture End Attempt',
    promptHtml: '<p>End the attempt.</p>',
    bodyHtml: '<p>End attempt body.</p>',
    responseIdentifier: 'END_ATTEMPT',
    endAttemptTitle: 'Finish Attempt',
    endAttemptCountAttempt: true,
  },
};

function assertString(value: unknown, label: string) {
  if (!(typeof value === 'string' && value.trim().length > 0)) expect.unreachable(label);
}

function assertArray(value: unknown, label: string, minLength = 1) {
  if (!(Array.isArray(value))) expect.unreachable(label);
  if (!((value as unknown[]).length >= minLength)) expect.unreachable(`${label} length`);
}

function assertNumber(value: unknown, label: string) {
  if (!(typeof value === 'number' && Number.isFinite(value))) expect.unreachable(label);
}

function assertBoolean(value: unknown, label: string) {
  if (!(typeof value === 'boolean')) expect.unreachable(label);
}

function assertFixtureSchema(typeId: QuestionTypeId, draft: Draft) {
  switch (typeId) {
    case 'single_select':
      assertArray(draft.choices, `${typeId}: choices`);
      assertString(draft.correctId, `${typeId}: correctId`);
      assertBoolean(draft.shuffle, `${typeId}: shuffle`);
      assertBoolean(draft.required, `${typeId}: required`);
      assertBoolean(draft.answerMasking, `${typeId}: answerMasking`);
      break;
    case 'multi_select':
      assertArray(draft.choices, `${typeId}: choices`);
      assertArray(draft.correctIds, `${typeId}: correctIds`);
      assertBoolean(draft.shuffle, `${typeId}: shuffle`);
      break;
    case 'text_entry':
      assertArray(draft.textEntries, `${typeId}: textEntries`, 2);
      assertString(draft.bodyHtml, `${typeId}: bodyHtml`);
      assertBoolean(draft.requirePattern, `${typeId}: requirePattern`);
      break;
    case 'order':
      assertArray(draft.choices, `${typeId}: choices`);
      assertArray(draft.correctOrder, `${typeId}: correctOrder`);
      break;
    case 'match':
      assertArray(draft.sources, `${typeId}: sources`);
      assertArray(draft.targets, `${typeId}: targets`);
      assertArray(draft.correctPairs, `${typeId}: correctPairs`);
      break;
    case 'associate':
      assertArray(draft.choices, `${typeId}: choices`);
      assertArray(draft.correctPairs, `${typeId}: correctPairs`);
      assertBoolean(draft.shuffle, `${typeId}: shuffle`);
      break;
    case 'inline_choice':
      assertArray(draft.inlineChoices, `${typeId}: inlineChoices`);
      assertString(draft.bodyHtml, `${typeId}: bodyHtml`);
      assertString(draft.responseMode, `${typeId}: responseMode`);
      break;
    case 'extended_text':
      assertString(draft.responseIdentifier, `${typeId}: responseIdentifier`);
      assertString(draft.rubricHtml, `${typeId}: rubricHtml`);
      assertNumber(draft.expectedLength, `${typeId}: expectedLength`);
      assertNumber(draft.expectedLines, `${typeId}: expectedLines`);
      break;
    case 'gap_match':
      assertArray(draft.gapChoices, `${typeId}: gapChoices`);
      assertArray(draft.gaps, `${typeId}: gaps`);
      assertArray(draft.correctGapPairs, `${typeId}: correctGapPairs`);
      assertString(draft.responseIdentifier, `${typeId}: responseIdentifier`);
      break;
    case 'graphic_gap_match':
      assertString(draft.graphicBackgroundSrc, `${typeId}: graphicBackgroundSrc`);
      assertArray(draft.choices, `${typeId}: choices`);
      assertArray(draft.targets, `${typeId}: targets`);
      assertArray(draft.correctPairs, `${typeId}: correctPairs`);
      break;
    case 'graphic_associate':
      assertString(draft.graphicAssociateBackgroundSrc, `${typeId}: backgroundSrc`);
      assertArray(draft.graphicAssociateHotspots, `${typeId}: hotspots`);
      assertArray(draft.graphicAssociateCorrectPairs, `${typeId}: correctPairs`);
      break;
    case 'graphic_order':
      assertString(draft.graphicOrderBackgroundSrc, `${typeId}: backgroundSrc`);
      assertArray(draft.graphicOrderHotspots, `${typeId}: hotspots`, 2);
      assertArray(draft.graphicOrderCorrectOrder, `${typeId}: correctOrder`, 2);
      break;
    case 'media':
      assertArray(draft.mediaSources, `${typeId}: mediaSources`);
      assertBoolean(draft.mediaAutostart, `${typeId}: mediaAutostart`);
      assertBoolean(draft.mediaLoop, `${typeId}: mediaLoop`);
      assertString(draft.responseIdentifier, `${typeId}: responseIdentifier`);
      break;
    case 'portable_custom':
      assertString(draft.portableCustomTypeIdentifier, `${typeId}: typeIdentifier`);
      assertString(draft.portableBaseType, `${typeId}: baseType`);
      assertString(draft.portableCardinality, `${typeId}: cardinality`);
      assertArray(draft.portableDataAttributes, `${typeId}: dataAttributes`, 2);
      assertArray(draft.portableInteractionModules, `${typeId}: modules`, 1);
      assertString(draft.portableInteractionMarkup, `${typeId}: markup`);
      break;
    case 'position_object':
      assertString(draft.positionStageSrc, `${typeId}: stageSrc`);
      assertString(draft.positionObjectSrc, `${typeId}: objectSrc`);
      assertArray(draft.positionTargets, `${typeId}: targets`, 1);
      assertArray(draft.positionCorrectPoints, `${typeId}: correctPoints`, 1);
      assertNumber(draft.positionStageWidth, `${typeId}: stageWidth`);
      assertNumber(draft.positionStageHeight, `${typeId}: stageHeight`);
      assertNumber(draft.positionObjectWidth, `${typeId}: objectWidth`);
      assertNumber(draft.positionObjectHeight, `${typeId}: objectHeight`);
      break;
    case 'select_point':
      assertString(draft.selectPointImageSrc, `${typeId}: imageSrc`);
      assertArray(draft.selectPointTargets, `${typeId}: targets`, 1);
      assertArray(draft.selectPointCorrectPoints, `${typeId}: correctPoints`, 1);
      assertNumber(draft.selectPointImageWidth, `${typeId}: imageWidth`);
      assertNumber(draft.selectPointImageHeight, `${typeId}: imageHeight`);
      break;
    case 'slider':
      assertNumber(draft.sliderLowerBound, `${typeId}: lowerBound`);
      assertNumber(draft.sliderUpperBound, `${typeId}: upperBound`);
      assertNumber(draft.sliderStep, `${typeId}: step`);
      assertNumber(draft.sliderCorrectValue, `${typeId}: correctValue`);
      assertArray(draft.sliderMappings, `${typeId}: mappings`, 1);
      break;
    case 'upload':
      assertString(draft.responseIdentifier, `${typeId}: responseIdentifier`);
      assertString(draft.bodyHtml, `${typeId}: bodyHtml`);
      assertNumber(draft.uploadMaxFileSize, `${typeId}: maxFileSize`);
      assertString(draft.uploadFileTypes, `${typeId}: fileTypes`);
      assertBoolean(draft.uploadMultiple, `${typeId}: multiple`);
      break;
    case 'hotspot':
      assertString(draft.hotspotImageSrc, `${typeId}: imageSrc`);
      assertArray(draft.choices, `${typeId}: choices`);
      assertArray(draft.correctIds, `${typeId}: correctIds`);
      break;
    case 'hottext':
      assertArray(draft.hottexts, `${typeId}: hottexts`);
      assertArray(draft.correctIds, `${typeId}: correctIds`);
      assertString(draft.bodyHtml, `${typeId}: bodyHtml`);
      break;
    case 'custom_interaction':
      assertString(draft.responseIdentifier, `${typeId}: responseIdentifier`);
      assertString(draft.customBaseType, `${typeId}: customBaseType`);
      assertString(draft.customCardinality, `${typeId}: customCardinality`);
      assertArray(draft.customAttributes, `${typeId}: customAttributes`, 2);
      assertString(draft.customInteractionMarkup, `${typeId}: customInteractionMarkup`);
      assertString(draft.customResponseProcessingXml, `${typeId}: customResponseProcessingXml`);
      break;
    case 'drawing':
      assertString(draft.drawingImageSrc, `${typeId}: drawingImageSrc`);
      assertNumber(draft.drawingImageWidth, `${typeId}: drawingImageWidth`);
      assertNumber(draft.drawingImageHeight, `${typeId}: drawingImageHeight`);
      break;
    case 'end_attempt':
      assertString(draft.endAttemptTitle, `${typeId}: endAttemptTitle`);
      assertBoolean(draft.endAttemptCountAttempt, `${typeId}: endAttemptCountAttempt`);
      break;
    default:
      throw new Error(`Unhandled fixture schema: ${typeId}`);
  }
}

testCase('driver adapters: fixture serialize/hydrate stability', () => {
  for (const typeId of QUESTION_TYPE_IDS) {
    const driver = TYPE_DRIVERS[typeId];
    const fixture = fixtures[typeId];
    if (!fixture) expect.unreachable(`Missing fixture for ${typeId}`);

    const normalized = normalizeDraftForDriver(typeId, fixture);
    const serialized = driver.serialize(normalized);
    const renormalized = normalizeDraftForDriver(typeId, serialized);
    const reserialized = driver.serialize(renormalized);

    expect(reserialized, `${typeId}: serialize(hydrate) stability`).toStrictEqual(serialized);

    const errors = driver.validate(normalized);
    expect(errors, `${typeId}: fixture is valid`).toStrictEqual([]);

    assertFixtureSchema(typeId, serialized);
  }
});
