import type { Draft } from './draft.ts';

type DraftRecord = Record<string, unknown>;

const ARRAY_FIELDS_DEFAULT_EMPTY = new Set([
  'portableDataAttributes',
  'positionCorrectPoints',
  'selectPointCorrectPoints',
  'customAttributes',
  'sliderMappings',
]);

const ARRAY_FIELDS = [
  'choices',
  'correctIds',
  'textEntries',
  'inlineChoices',
  'hottexts',
  'graphicAssociateHotspots',
  'graphicAssociateCorrectPairs',
  'graphicOrderHotspots',
  'graphicOrderCorrectOrder',
  'mediaSources',
  'portableInteractionModules',
  'portableDataAttributes',
  'positionTargets',
  'positionCorrectPoints',
  'selectPointTargets',
  'selectPointCorrectPoints',
  'sliderMappings',
  'customAttributes',
  'sources',
  'targets',
  'correctPairs',
  'correctOrder',
] as const;

export function hydrateDraftFromDefaults(
  typeId: string,
  rawDraft: Draft,
  defaults: DraftRecord,
): DraftRecord {
  const draftRecord = { ...defaults, ...rawDraft, type: typeId } as DraftRecord;
  draftRecord.itemLanguage = rawDraft.itemLanguage;

  for (const field of ARRAY_FIELDS) {
    const rawValue = (rawDraft as DraftRecord)[field];
    const defaultValue = defaults[field];
    draftRecord[field] = Array.isArray(rawValue)
      ? rawValue
      : Array.isArray(defaultValue)
      ? defaultValue
      : ARRAY_FIELDS_DEFAULT_EMPTY.has(field)
      ? []
      : defaultValue;
  }

  draftRecord.title = rawDraft.title ?? defaults.title ?? 'Untitled';
  draftRecord.promptHtml = rawDraft.promptHtml ?? defaults.promptHtml ?? '';
  draftRecord.bodyHtml = rawDraft.bodyHtml ?? defaults.bodyHtml ?? '';

  draftRecord.requirePattern = rawDraft.requirePattern ?? defaults.requirePattern;

  draftRecord.shuffle = typeof rawDraft.shuffle === 'boolean'
    ? rawDraft.shuffle
    : defaults.shuffle ?? false;
  draftRecord.minAssociations = typeof rawDraft.minAssociations === 'number'
    ? rawDraft.minAssociations
    : defaults.minAssociations;
  draftRecord.maxAssociations = typeof rawDraft.maxAssociations === 'number'
    ? rawDraft.maxAssociations
    : defaults.maxAssociations;
  draftRecord.minChoices = typeof rawDraft.minChoices === 'number'
    ? rawDraft.minChoices
    : defaults.minChoices;
  draftRecord.maxChoices = typeof rawDraft.maxChoices === 'number'
    ? rawDraft.maxChoices
    : defaults.maxChoices;
  draftRecord.required = typeof rawDraft.required === 'boolean'
    ? rawDraft.required
    : defaults.required;
  draftRecord.answerMasking = typeof rawDraft.answerMasking === 'boolean'
    ? rawDraft.answerMasking
    : defaults.answerMasking;
  draftRecord.responseMode = rawDraft.responseMode ?? defaults.responseMode ??
    'all_or_nothing';
  draftRecord.sharedVocabulary = (rawDraft as DraftRecord).sharedVocabulary ??
    defaults.sharedVocabulary;

  copyScalarFields(rawDraft, defaults, draftRecord, SCALAR_FIELDS);

  if (typeId === 'single_select') {
    const choices = draftRecord.choices as Array<{ id?: string }> | undefined;
    draftRecord.correctId = rawDraft.correctId ?? defaults.correctId ?? choices?.[0]?.id ??
      '';
  }

  return draftRecord;
}

const SCALAR_FIELDS = [
  'graphicBackgroundSrc',
  'graphicBackgroundAlt',
  'graphicBackgroundLongDesc',
  'graphicBackgroundType',
  'graphicAssociateBackgroundSrc',
  'graphicAssociateBackgroundAlt',
  'graphicAssociateBackgroundLongDesc',
  'graphicAssociateBackgroundType',
  'graphicAssociateBackgroundWidth',
  'graphicAssociateBackgroundHeight',
  'graphicOrderBackgroundSrc',
  'graphicOrderBackgroundAlt',
  'graphicOrderBackgroundLongDesc',
  'graphicOrderBackgroundType',
  'graphicOrderBackgroundWidth',
  'graphicOrderBackgroundHeight',
  'mediaKind',
  'mediaInteractionLabel',
  'mediaObjectLabel',
  'mediaCaptionSrc',
  'mediaCaptionLang',
  'mediaTranscript',
  'mediaAutostart',
  'mediaLoop',
  'mediaMinPlays',
  'mediaMaxPlays',
  'mediaCoords',
  'mediaWidth',
  'mediaHeight',
  'portableCustomTypeIdentifier',
  'portableModule',
  'portableClassName',
  'portableLabel',
  'portableBaseType',
  'portableCardinality',
  'portableInteractionMarkup',
  'portableModulesPrimaryConfiguration',
  'portableModulesSecondaryConfiguration',
  'portableResponseProcessingXml',
  'positionStageSrc',
  'positionStageAlt',
  'positionStageLongDesc',
  'positionStageType',
  'positionStageWidth',
  'positionStageHeight',
  'positionObjectSrc',
  'positionObjectAlt',
  'positionObjectType',
  'positionObjectWidth',
  'positionObjectHeight',
  'positionCenterPoint',
  'selectPointImageSrc',
  'selectPointImageAlt',
  'selectPointImageLongDesc',
  'selectPointImageType',
  'selectPointImageWidth',
  'selectPointImageHeight',
  'sliderLowerBound',
  'sliderUpperBound',
  'sliderStep',
  'sliderStepLabel',
  'sliderOrientation',
  'sliderReverse',
  'sliderCorrectValue',
  'uploadMaxFileSize',
  'uploadFileTypes',
  'uploadMultiple',
  'hotspotImageSrc',
  'hotspotImageAlt',
  'hotspotImageType',
  'hotspotImageLongDesc',
  'customBaseType',
  'customCardinality',
  'customClassName',
  'customDefinition',
  'customInteractionMarkup',
  'endAttemptTitle',
  'endAttemptCountAttempt',
  'drawingImageSrc',
  'drawingImageAlt',
  'drawingImageLongDesc',
  'drawingImageType',
  'drawingImageWidth',
  'drawingImageHeight',
] as const;

function copyScalarFields(
  rawDraft: Draft,
  defaults: DraftRecord,
  target: DraftRecord,
  fields: readonly string[],
): void {
  const raw = rawDraft as DraftRecord;
  for (const field of fields) {
    target[field] = raw[field] ?? defaults[field];
  }
}
