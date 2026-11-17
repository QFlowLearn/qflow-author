import type { QtiAssessmentItem, QtiInteraction } from '@longsightgroup/qti3-core';

type QtiResponseDeclaration = QtiAssessmentItem['responseDeclarations'][number];
type QtiMapEntry = NonNullable<QtiResponseDeclaration['mapping']>['entries'][number];
type QtiAreaMapEntry = NonNullable<QtiResponseDeclaration['areaMapping']>['entries'][number];
import type { Draft } from '../../../../types/draft.ts';
import type { MappedQtiDraft } from '../qti_import_support.ts';
import {
  bodyHtmlFromContentNodes,
  extractRubricHtml,
  promptHtmlFromInteraction,
  serializeContentNodes,
} from '../content_html.ts';
import {
  attrBool,
  attrNumber,
  attrPositiveInt,
  correctIdentifiers,
  importedBase,
  itemTitle,
  responseDeclarationFor,
  responseProcessingTemplateXml,
} from '../qti_import_support.ts';
import {
  mergeInteractionVocabulary,
  parseMediaInteractionVocabulary,
} from '../../../../shared_vocabulary.ts';

function mediaTranscriptFromCompanionMaterials(
  item: QtiAssessmentItem,
): string | undefined {
  const text = item.companionMaterials?.physicalMaterials[0]?.text?.trim();
  return text || undefined;
}

export function mapMedia(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'media' } {
  const object = interaction.object;
  const mediaKind = object?.sources.length
    ? (interaction.childElements.some((child) => child.qtiName === 'video') ? 'video' : 'audio')
    : object?.type?.startsWith('video/') || object?.data?.includes('.mp4')
    ? 'video'
    : object?.data
    ? 'object'
    : undefined;
  const captionsTrack =
    object?.tracks.find((track) => (track.kind ?? '').toLowerCase() === 'captions') ??
      object?.tracks[0];
  const sharedVocabulary = mergeInteractionVocabulary(
    parseMediaInteractionVocabulary(interaction.attributes),
    object ? parseMediaInteractionVocabulary(object.attributes) : undefined,
  );

  return {
    type: 'media',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    responseIdentifier: interaction.responseIdentifier ?? 'RESPONSE',
    mediaKind,
    mediaSources:
      (object?.sources.length
        ? object.sources
        : object?.data
        ? [{ src: object.data, type: object.type }]
        : [])
        .map((source) => ({ src: source.src ?? '', type: source.type }))
        .filter((source) => source.src.trim().length > 0),
    mediaInteractionLabel: interaction.attributes.label?.trim() || undefined,
    mediaObjectLabel: object?.attributes.label?.trim() || undefined,
    mediaCaptionSrc: captionsTrack?.src,
    mediaCaptionLang: captionsTrack?.srclang,
    mediaAutostart: attrBool(interaction.attributes.autostart),
    mediaLoop: attrBool(interaction.attributes.loop),
    mediaMinPlays: attrNumber(interaction.attributes['min-plays']),
    mediaMaxPlays: attrNumber(interaction.attributes['max-plays']),
    mediaCoords: interaction.attributes.coords?.trim() || undefined,
    mediaWidth: attrNumber(object?.width),
    mediaHeight: attrNumber(object?.height),
    mediaTranscript: mediaTranscriptFromCompanionMaterials(item),
    sharedVocabulary,
  };
}

export function mapPositionObject(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'position_object' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const stage = interaction.positionObjectStage;
  const object = interaction.object;
  const areaMapping = responseDecl?.areaMapping;
  const stageAlt = stage?.text?.trim() || stage?.attributes.alt || itemTitle(item);
  const objectAlt = object?.text?.trim() || object?.attributes.alt || 'Position object';
  const importWarnings = [
    ...(stage && !stage?.text?.trim() && !stage?.attributes.alt
      ? [{
        code: 'MISSING_ALT_REPAIRED',
        message: 'Position object stage alt text was missing; defaulted from the item title.',
      }]
      : []),
    ...(object && !object?.text?.trim() && !object?.attributes.alt
      ? [{
        code: 'MISSING_ALT_REPAIRED',
        message: 'Position object movable object alt text was missing; defaulted for export.',
      }]
      : []),
  ];

  return {
    type: 'position_object',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    responseIdentifier,
    positionStageSrc: stage?.data ?? '',
    positionStageAlt: stageAlt,
    positionStageType: stage?.type || undefined,
    positionStageWidth: attrNumber(stage?.width),
    positionStageHeight: attrNumber(stage?.height),
    positionObjectSrc: object?.data ?? '',
    positionObjectAlt: objectAlt,
    positionObjectType: object?.type || undefined,
    positionObjectWidth: attrNumber(object?.width),
    positionObjectHeight: attrNumber(object?.height),
    positionCenterPoint: interaction.attributes['center-point'] || undefined,
    positionTargets: areaMapping?.entries.map((entry: QtiAreaMapEntry) => ({
      shape: entry.shape,
      coords: entry.coords.join(','),
      mappedValue: entry.mappedValue,
    })) ?? [],
    positionCorrectPoints: correctIdentifiers(responseDecl),
    minChoices: attrPositiveInt(interaction.attributes['min-choices']),
    maxChoices: attrPositiveInt(interaction.attributes['max-choices']),
    importWarnings,
  };
}

export function mapSelectPoint(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'select_point' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const image = interaction.object;
  const areaMapping = responseDecl?.areaMapping;

  return {
    type: 'select_point',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    responseIdentifier,
    selectPointImageSrc: image?.data ?? '',
    selectPointImageAlt: image?.text?.trim() || image?.attributes.alt || undefined,
    selectPointImageType: image?.attributes.type,
    selectPointImageWidth: attrNumber(image?.width),
    selectPointImageHeight: attrNumber(image?.height),
    selectPointTargets: areaMapping?.entries.map((entry: QtiAreaMapEntry) => ({
      shape: entry.shape,
      coords: entry.coords.join(','),
      mappedValue: entry.mappedValue,
    })) ?? [],
    selectPointCorrectPoints: correctIdentifiers(responseDecl),
    minChoices: attrPositiveInt(interaction.attributes['min-choices']),
    maxChoices: attrPositiveInt(interaction.attributes['max-choices']),
  };
}

export function mapSlider(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'slider' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const correctValues = correctIdentifiers(responseDecl);
  return {
    type: 'slider',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    responseIdentifier,
    sliderLowerBound: attrNumber(interaction.attributes['lower-bound']),
    sliderUpperBound: attrNumber(interaction.attributes['upper-bound']),
    sliderStep: attrNumber(interaction.attributes.step),
    sliderStepLabel: attrBool(interaction.attributes['step-label']),
    sliderOrientation: interaction.attributes.orientation === 'horizontal' ||
        interaction.attributes.orientation === 'vertical'
      ? interaction.attributes.orientation
      : undefined,
    sliderReverse: attrBool(interaction.attributes.reverse),
    sliderCorrectValue: correctValues.length ? attrNumber(correctValues[0]) : undefined,
    sliderMappings: responseDecl?.mapping?.entries.map((entry: QtiMapEntry) => ({
      mapKey: attrNumber(entry.mapKey) ?? 0,
      mappedValue: entry.mappedValue,
    })) ?? [],
  };
}

export function mapUpload(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'upload' } {
  const score = item.outcomeDeclarations.find((declaration) => declaration.identifier === 'SCORE');
  return {
    type: 'upload',
    externalScored: score?.attributes['external-scored'] === 'human' ? 'human' : undefined,
    rubricHtml: extractRubricHtml(item.body),
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
      excludeElementNames: new Set(['qti-rubric-block']),
    }),
    responseIdentifier: interaction.responseIdentifier ?? 'RESPONSE',
    uploadMaxFileSize: attrNumber(interaction.attributes['data-max-size']),
    uploadFileTypes: interaction.attributes['data-file-types'] || undefined,
    uploadMultiple: attrBool(interaction.attributes['data-multiple']),
    uploadClassName: interaction.attributes.class || undefined,
  };
}

export function mapEndAttempt(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'end_attempt' } {
  return {
    type: 'end_attempt',
    ...importedBase(itemTitle(item)),
    promptHtml: '',
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    responseIdentifier: interaction.responseIdentifier ?? 'END_ATTEMPT',
    endAttemptTitle: interaction.attributes.title ?? 'End Attempt',
    endAttemptCountAttempt: attrBool(interaction.attributes['count-attempt']),
  };
}

export function mapDrawing(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'drawing' } {
  const image = interaction.object;
  const imageAlt = image?.text?.trim() || image?.attributes.alt || itemTitle(item);
  return {
    type: 'drawing',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    responseIdentifier: interaction.responseIdentifier ?? 'RESPONSE',
    drawingClassName: interaction.attributes.class || undefined,
    drawingImageSrc: image?.data ?? '',
    drawingImageAlt: imageAlt,
    drawingImageType: image?.type || undefined,
    drawingImageWidth: attrNumber(image?.width),
    drawingImageHeight: attrNumber(image?.height),
    importWarnings: image && !image?.text?.trim() && !image?.attributes.alt
      ? [{
        code: 'MISSING_ALT_REPAIRED',
        message: 'Drawing image alt text was missing; defaulted from the item title.',
      }]
      : [],
  };
}

export function mapPortableCustom(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'portable_custom' } {
  const portable = interaction.portableCustom;
  const responseIdentifier = interaction.responseIdentifier ?? portable?.responseIdentifier ??
    'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  return {
    type: 'portable_custom',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    responseIdentifier,
    portableCustomTypeIdentifier: portable?.customInteractionTypeIdentifier || undefined,
    portableModule: portable?.module ?? interaction.attributes.module,
    portableClassName: interaction.attributes.class || undefined,
    portableLabel: interaction.attributes.label || undefined,
    portableBaseType: responseDecl?.baseType ?? 'string',
    portableCardinality: responseDecl?.cardinality ?? 'single',
    portableInteractionMarkup: portable?.interactionMarkupRaw ??
      serializeContentNodes(portable?.interactionMarkup ?? []),
    portableDataAttributes: Object.entries(portable?.dataAttributes ?? {}).map(([name, value]) => ({
      name,
      value,
    })),
    portableInteractionModules: portable?.interactionModules?.modules.map((module) => ({
      id: module.id ?? '',
      primaryPath: module.primaryPath,
      fallbackPath: module.fallbackPath,
    })) ?? [],
    portableModulesPrimaryConfiguration: portable?.interactionModules?.primaryConfiguration,
    portableModulesSecondaryConfiguration: portable?.interactionModules?.secondaryConfiguration,
    portableResponseProcessingXml: responseProcessingTemplateXml(item),
  };
}

export function mapCustomInteraction(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'custom_interaction' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  return {
    type: 'custom_interaction',
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
    }),
    responseIdentifier,
    customBaseType: responseDecl?.baseType ?? 'string',
    customCardinality: responseDecl?.cardinality ?? 'single',
    customClassName: interaction.attributes.class || undefined,
    customDefinition: interaction.attributes.definition || undefined,
    customAttributes: Object.entries(interaction.attributes)
      .filter(([name]) => name.startsWith('data-'))
      .map(([name, value]) => ({ name, value })),
    // qti3-core lists custom-interaction child tag names only; inner HTML is not parsed yet.
    customInteractionMarkup: undefined,
    customResponseProcessingXml: responseProcessingTemplateXml(item),
  };
}

export function mapExtendedText(
  item: QtiAssessmentItem,
  interaction: QtiInteraction,
): MappedQtiDraft & { type: 'extended_text' } {
  const responseIdentifier = interaction.responseIdentifier ?? 'RESPONSE';
  const responseDecl = responseDeclarationFor(item, responseIdentifier);
  const { heightClass, counterType } = parseExtendedTextClasses(interaction.attributes.class ?? '');
  const score = item.outcomeDeclarations.find((declaration) => declaration.identifier === 'SCORE');
  return {
    type: 'extended_text',
    externalScored: score?.attributes['external-scored'] === 'human' ? 'human' : undefined,
    ...importedBase(itemTitle(item)),
    promptHtml: promptHtmlFromInteraction(interaction),
    bodyHtml: bodyHtmlFromContentNodes(item.body, {
      excludeInteractionIndexes: new Set([item.interactions.indexOf(interaction)]),
      excludeElementNames: new Set(['qti-rubric-block']),
      replaceObjects: true,
    }),
    responseIdentifier,
    base: attrNumber(interaction.attributes.base),
    stringIdentifier: interaction.attributes['string-identifier'] || undefined,
    expectedLength: attrNumber(interaction.attributes['expected-length']),
    expectedLines: attrNumber(interaction.attributes['expected-lines']),
    minStrings: attrNumber(interaction.attributes['min-strings']),
    maxStrings: attrNumber(interaction.attributes['max-strings']),
    placeholderText: interaction.attributes['placeholder-text'] || undefined,
    format: parseExtendedTextFormat(interaction.attributes.format),
    responseBaseType: responseDecl?.baseType === 'string' ||
        responseDecl?.baseType === 'integer' ||
        responseDecl?.baseType === 'float'
      ? responseDecl.baseType
      : undefined,
    responseCardinality: responseDecl?.cardinality === 'single' ||
        responseDecl?.cardinality === 'multiple' ||
        responseDecl?.cardinality === 'ordered'
      ? responseDecl.cardinality
      : undefined,
    patternMask: interaction.attributes['pattern-mask'] || undefined,
    patternMessage: interaction.attributes['data-patternmask-message'] || undefined,
    heightClass,
    counterType,
    rubricHtml: extractRubricHtml(item.body),
  };
}

function parseExtendedTextFormat(
  value: string | undefined,
): Draft['format'] | undefined {
  if (value === 'plain' || value === 'xhtml') return value;
  return undefined;
}

function parseExtendedTextClasses(value: string): {
  heightClass?: string;
  counterType?: 'none' | 'up' | 'down';
} {
  const tokens = (value ?? '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const heightClass = tokens.find((token) => token.startsWith('qti-height-lines-'));
  const counterType = tokens.includes('qti-counter-up')
    ? 'up'
    : tokens.includes('qti-counter-down')
    ? 'down'
    : 'none';
  return { heightClass, counterType };
}
