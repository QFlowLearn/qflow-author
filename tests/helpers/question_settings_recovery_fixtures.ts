import { defaultsMatch } from '../../lib/types/match.ts';
import { defaultsSingleSelect } from '../../lib/types/single_select.ts';
import { defaultsMultiSelect } from '../../lib/types/multi_select.ts';
import { defaultsAssociate } from '../../lib/types/associate.ts';
import { defaultsOrder } from '../../lib/types/order.ts';
import { defaultsTextEntry } from '../../lib/types/text_entry.ts';
import { defaultsExtendedText } from '../../lib/types/extended_text.ts';
import { defaultsUpload } from '../../lib/types/upload.ts';
import { defaultsInlineChoice } from '../../lib/types/inline_choice.ts';
import { defaultsGapMatch } from '../../lib/types/gap_match.ts';
import { defaultsHottext } from '../../lib/types/hottext.ts';
import { defaultsSlider } from '../../lib/types/slider.ts';
import { defaultsHotspot } from '../../lib/types/hotspot.ts';
import { defaultsSelectPoint } from '../../lib/types/select_point.ts';
import { defaultsPositionObject } from '../../lib/types/position_object.ts';
import { defaultsGraphicAssociate } from '../../lib/types/graphic_associate.ts';
import { defaultsGraphicOrder } from '../../lib/types/graphic_order.ts';
import { defaultsGraphicGapMatch } from '../../lib/types/graphic_gap_match.ts';
import { defaultsDrawing } from '../../lib/types/drawing.ts';
import { defaultsEndAttempt } from '../../lib/types/end_attempt.ts';
import { defaultsMedia } from '../../lib/types/media.ts';
import { defaultsCustomInteraction } from '../../lib/types/custom_interaction.ts';
import { defaultsPortableCustom } from '../../lib/types/portable_custom.ts';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import type { Draft } from '../../lib/types/draft.ts';

/** Extra authored fields whose exact values must survive failed review and successful retry. */
export const preservedRecoveryFields: Partial<Record<QuestionTypeId, readonly (keyof Draft)[]>> = {
  hottext: ['hottexts', 'correctIds'],
  hotspot: ['correctIds', 'hotspotImageSrc', 'hotspotImageAlt', 'hotspotImageType'],
  select_point: ['selectPointCorrectPoints', 'selectPointTargets', 'selectPointImageSrc'],
  position_object: [
    'positionCorrectPoints',
    'positionTargets',
    'positionStageSrc',
    'positionObjectSrc',
  ],
  slider: [
    'sliderCorrectValue',
    'sliderMappings',
    'sliderLowerBound',
    'sliderUpperBound',
    'sliderStep',
    'sliderOrientation',
  ],
  graphic_associate: [
    'graphicAssociateHotspots',
    'graphicAssociateCorrectPairs',
    'graphicAssociateBackgroundSrc',
  ],
  graphic_order: ['graphicOrderHotspots', 'graphicOrderCorrectOrder', 'graphicOrderBackgroundSrc'],
  graphic_gap_match: ['graphicBackgroundSrc', 'sharedVocabulary'],
  drawing: ['drawingImageSrc', 'drawingImageAlt'],
  end_attempt: ['endAttemptTitle', 'endAttemptCountAttempt'],
  media: ['mediaSources', 'mediaKind', 'mediaTranscript'],
  custom_interaction: ['customInteractionMarkup', 'customAttributes'],
  portable_custom: ['portableInteractionMarkup', 'portableDataAttributes'],
};

/** Fresh defaults and authored structures for every specialist recovery scenario. */
export function questionSettingsRecoveryCases() {
  const multipleHottext = { ...defaultsHottext(), maxChoices: 2, correctIds: ['A', 'B'] };
  const hotspot = {
    ...defaultsHotspot(),
    hotspotImageSrc: '/images/recovery.svg',
    hotspotImageAlt: 'Retained hotspot image',
    hotspotImageType: 'image/svg+xml',
  };
  const multipleHotspot = { ...hotspot, maxChoices: 2, correctIds: ['A', 'B'] };
  const media = {
    ...defaultsMedia(),
    mediaSources: [{ src: '/media/recovery.mp4', type: 'video/mp4' }],
    mediaTranscript: 'Retained transcript.',
  };
  const manyChoices = Array.from({ length: 12 }, (_, index) => ({
    id: String.fromCharCode(65 + index),
    text: index % 2 === 0
      ? `Answer ${index + 1}`
      : 'A longer answer that describes the evidence and explains how it supports the conclusion.',
  }));
  return [
    {
      type: 'single_select',
      initial: { ...defaultsSingleSelect(), choices: manyChoices },
      fields: ['prompt'],
      labels: ['inspector.reviewPrompt'],
    },
    {
      type: 'multi_select',
      initial: { ...defaultsMultiSelect(), choices: manyChoices },
      fields: ['prompt'],
      labels: ['inspector.reviewPrompt'],
    },
    {
      type: 'graphic_associate',
      initial: {
        ...defaultsGraphicAssociate(),
        graphicAssociateBackgroundSrc: '/images/recovery.svg',
      },
      fields: ['choices', 'matchPairs', 'correct'],
      labels: [
        'inspector.reviewAnswers',
        'inspector.reviewMatchingPairs',
        'inspector.reviewCorrectAnswer',
      ],
    },
    {
      type: 'graphic_order',
      initial: { ...defaultsGraphicOrder(), graphicOrderBackgroundSrc: '/images/recovery.svg' },
      fields: ['choices', 'order', 'correct'],
      labels: [
        'inspector.reviewAnswers',
        'inspector.reviewOrder',
        'inspector.reviewCorrectAnswer',
      ],
    },
    {
      type: 'graphic_gap_match',
      initial: {
        ...defaultsGraphicGapMatch(),
        graphicBackgroundSrc: '/images/recovery.svg',
        choices: defaultsGraphicGapMatch().choices.map((choice) => ({
          ...choice,
          imgSrc: '/images/recovery.svg',
        })),
      },
      fields: ['choices', 'matchSources', 'matchTargets', 'matchPairs', 'correct'],
      labels: [
        'inspector.reviewAnswers',
        'inspector.reviewMatchingSources',
        'inspector.reviewMatchingTargets',
        'inspector.reviewMatchingPairs',
        'inspector.reviewCorrectAnswer',
      ],
    },
    {
      type: 'drawing',
      initial: { ...defaultsDrawing(), drawingImageSrc: '/images/recovery.svg' },
      fields: ['prompt'],
      labels: ['inspector.reviewPrompt'],
    },
    {
      type: 'end_attempt',
      initial: defaultsEndAttempt(),
      fields: ['prompt'],
      labels: ['inspector.reviewPrompt'],
    },
    {
      type: 'media',
      initial: media,
      fields: ['prompt'],
      labels: ['inspector.reviewPrompt'],
    },
    {
      type: 'custom_interaction',
      initial: defaultsCustomInteraction(),
      fields: ['prompt'],
      labels: ['inspector.reviewPrompt'],
    },
    {
      type: 'portable_custom',
      initial: defaultsPortableCustom(),
      fields: ['prompt'],
      labels: ['inspector.reviewPrompt'],
    },
    {
      type: 'hotspot',
      initial: hotspot,
      fields: ['choices', 'correct'],
      labels: ['inspector.reviewAnswers', 'inspector.reviewCorrectAnswer'],
    },
    {
      type: 'hotspot',
      initial: multipleHotspot,
      fields: ['choices', 'correct'],
      labels: ['inspector.reviewAnswers', 'inspector.reviewCorrectAnswer'],
    },
    {
      type: 'select_point',
      initial: { ...defaultsSelectPoint(), selectPointImageSrc: '/images/recovery.svg' },
      fields: ['correct'],
      labels: ['inspector.reviewCorrectAnswer'],
    },
    {
      type: 'position_object',
      initial: {
        ...defaultsPositionObject(),
        positionStageSrc: '/images/recovery.svg',
        positionObjectSrc: '/images/recovery.svg',
      },
      fields: ['correct'],
      labels: ['inspector.reviewCorrectAnswer'],
    },
    {
      type: 'hottext',
      initial: defaultsHottext(),
      fields: ['choices', 'correct'],
      labels: ['inspector.reviewAnswers', 'inspector.reviewCorrectAnswer'],
    },
    {
      type: 'hottext',
      initial: multipleHottext,
      fields: ['choices', 'correct'],
      labels: ['inspector.reviewAnswers', 'inspector.reviewCorrectAnswer'],
    },
    {
      type: 'slider',
      initial: defaultsSlider(),
      fields: ['correct'],
      labels: ['inspector.reviewCorrectAnswer'],
    },
    {
      type: 'inline_choice',
      initial: defaultsInlineChoice(),
      fields: ['choices', 'correct'],
      labels: ['inspector.reviewAnswers', 'inspector.reviewCorrectAnswer'],
    },
    {
      type: 'gap_match',
      initial: defaultsGapMatch(),
      fields: ['choices', 'matchPairs', 'correct'],
      labels: [
        'inspector.reviewAnswers',
        'inspector.reviewMatchingPairs',
        'inspector.reviewCorrectAnswer',
      ],
    },
    {
      type: 'extended_text',
      initial: { ...defaultsExtendedText(), rubricHtml: '<p>Retained scorer rubric.</p>' },
      fields: ['prompt'],
      labels: ['inspector.reviewPrompt'],
    },
    {
      type: 'upload',
      initial: {
        ...defaultsUpload(),
        uploadMaxFileSize: 4096,
        uploadFileTypes: '.pdf',
        uploadMultiple: true,
      },
      fields: ['prompt'],
      labels: ['inspector.reviewPrompt'],
    },
    {
      type: 'match',
      initial: defaultsMatch(),
      fields: ['matchSources', 'matchTargets', 'matchPairs'],
      labels: [
        'inspector.reviewMatchingSources',
        'inspector.reviewMatchingTargets',
        'inspector.reviewMatchingPairs',
      ],
    },
    {
      type: 'associate',
      initial: defaultsAssociate(),
      fields: ['choices', 'matchPairs'],
      labels: ['inspector.reviewAnswers', 'inspector.reviewMatchingPairs'],
    },
    {
      type: 'order',
      initial: defaultsOrder(),
      fields: ['order'],
      labels: ['inspector.reviewOrder'],
    },
    {
      type: 'text_entry',
      initial: defaultsTextEntry(),
      fields: ['textEntry'],
      labels: ['inspector.reviewTextEntries'],
    },
  ] as const;
}
