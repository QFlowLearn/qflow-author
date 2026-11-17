import { QUESTION_TYPE_IDS, type QuestionTypeId } from './question_type_id.ts';
export { isQuestionTypeId, QUESTION_TYPE_IDS, type QuestionTypeId } from './question_type_id.ts';
import type { Draft } from './draft.ts';
import { hydrateDraftFromDefaults } from './draft_hydrate.ts';
import type { Qti3AuthoringItem } from './qti3_writer_adapter.ts';
import type { QtiInteractionVocabulary } from '../shared_vocabulary.ts';
import type { ItemLanguage } from './item_language.ts';
import { singleSelectDriver } from './drivers/single_select.ts';
import { multiSelectDriver } from './drivers/multi_select.ts';
import { textEntryDriver } from './drivers/text_entry.ts';
import { orderDriver } from './drivers/order.ts';
import { matchDriver } from './drivers/match.ts';
import { associateDriver } from './drivers/associate.ts';
import { inlineChoiceDriver } from './drivers/inline_choice.ts';
import { extendedTextDriver } from './drivers/extended_text.ts';
import { gapMatchDriver } from './drivers/gap_match.ts';
import { graphicGapMatchDriver } from './drivers/graphic_gap_match.ts';
import { graphicAssociateDriver } from './drivers/graphic_associate.ts';
import { graphicOrderDriver } from './drivers/graphic_order.ts';
import { mediaDriver } from './drivers/media.ts';
import { portableCustomDriver } from './drivers/portable_custom.ts';
import { positionObjectDriver } from './drivers/position_object.ts';
import { selectPointDriver } from './drivers/select_point.ts';
import { sliderDriver } from './drivers/slider.ts';
import { uploadDriver } from './drivers/upload.ts';
import { hotspotDriver } from './drivers/hotspot.ts';
import { hottextDriver } from './drivers/hottext.ts';
import { customInteractionDriver } from './drivers/custom_interaction.ts';
import { drawingDriver } from './drivers/drawing.ts';
import { endAttemptDriver } from './drivers/end_attempt.ts';

const DRIVER_MAP = {
  single_select: singleSelectDriver,
  multi_select: multiSelectDriver,
  text_entry: textEntryDriver,
  order: orderDriver,
  match: matchDriver,
  associate: associateDriver,
  inline_choice: inlineChoiceDriver,
  extended_text: extendedTextDriver,
  gap_match: gapMatchDriver,
  graphic_gap_match: graphicGapMatchDriver,
  graphic_associate: graphicAssociateDriver,
  graphic_order: graphicOrderDriver,
  media: mediaDriver,
  portable_custom: portableCustomDriver,
  position_object: positionObjectDriver,
  select_point: selectPointDriver,
  slider: sliderDriver,
  upload: uploadDriver,
  hotspot: hotspotDriver,
  hottext: hottextDriver,
  custom_interaction: customInteractionDriver,
  drawing: drawingDriver,
  end_attempt: endAttemptDriver,
} as const satisfies Record<QuestionTypeId, unknown>;

type DriverMap = typeof DRIVER_MAP;

/** Hydrated draft contract selected by each registered question driver. */
export type DriverDraftByType = {
  readonly [K in QuestionTypeId]:
    & ReturnType<DriverMap[K]['defaults']>
    & Pick<Draft, 'itemLanguage'>
    & {
      readonly type: K;
    };
};

/** Hydrated draft contract for one selected question type. */
export type DriverDraft<K extends QuestionTypeId> = DriverDraftByType[K];

// Scaffolding for upcoming driver-based editor refactor
/** Public QTI build options; item language is always sourced from the Draft. */
export type PublicBuildOpts = {
  identifier?: string;
  scoring?: 'match_correct' | 'map_response';
  minChoices?: number;
  maxChoices?: number;
  required?: boolean;
  answerMasking?: boolean;
  classes?: string[];
  sharedVocabulary?: QtiInteractionVocabulary;
};

type InternalBuildOpts = PublicBuildOpts & { lang: ItemLanguage };

export type TypeDriver<D = unknown> = TypeDriverCore<D>;
export type NormalizedTypeDriver<D = unknown> =
  & Omit<TypeDriver<D>, 'validate' | 'toQti3AuthoringItem' | 'serialize' | 'hydrate'>
  & {
    hydrate: (draft: Draft) => D;
    serialize: (draft: Draft) => Draft;
    validate: (draft: Draft) => string[];
    toQti3AuthoringItem: (draft: Draft, opts?: PublicBuildOpts) => Qti3AuthoringItem;
  };

type TypeDriverCore<D> = {
  id: QuestionTypeId;
  label: string;
  defaults: () => D;
  validate: (draft: D) => string[];
  hydrate?: (draft: Draft) => D;
  serialize?: (draft: D) => Draft;
  toQti3AuthoringItem: (draft: D, opts: InternalBuildOpts) => Qti3AuthoringItem;
  scoringTemplates?: Array<{ id: string; label: string; description?: string; disabled?: boolean }>;
  capabilities?: {
    points?: boolean;
    shuffle?: boolean;
    required?: boolean;
    minMaxChoices?: boolean;
    answerMasking?: boolean;
  };
};

function withDriverDefaults<D>(driver: TypeDriver<D>): NormalizedTypeDriver<D> {
  const hydrateImpl = driver.hydrate ??
    ((draft: Draft) =>
      hydrateDraftFromDefaults(
        driver.id,
        draft,
        driver.defaults() as Record<string, unknown>,
      ) as D);
  const serializeImpl = driver.serialize ?? ((draft: D) => draft as unknown as Draft);
  return {
    ...driver,
    hydrate: hydrateImpl,
    serialize: (draft: Draft) => serializeImpl(draft as unknown as D),
    validate: (
      draft: Draft,
    ) => [...questionPointsErrors(draft), ...driver.validate(draft as unknown as D)],
    toQti3AuthoringItem: (draft: Draft, opts?: PublicBuildOpts) =>
      driver.toQti3AuthoringItem(draft as unknown as D, {
        ...opts,
        lang: draft.itemLanguage,
      }),
  };
}

export const TYPE_DRIVERS = {
  single_select: withDriverDefaults(singleSelectDriver),
  multi_select: withDriverDefaults(multiSelectDriver),
  text_entry: withDriverDefaults(textEntryDriver),
  order: withDriverDefaults(orderDriver),
  match: withDriverDefaults(matchDriver),
  associate: withDriverDefaults(associateDriver),
  inline_choice: withDriverDefaults(inlineChoiceDriver),
  extended_text: withDriverDefaults(extendedTextDriver),
  gap_match: withDriverDefaults(gapMatchDriver),
  graphic_gap_match: withDriverDefaults(graphicGapMatchDriver),
  graphic_associate: withDriverDefaults(graphicAssociateDriver),
  graphic_order: withDriverDefaults(graphicOrderDriver),
  media: withDriverDefaults(mediaDriver),
  portable_custom: withDriverDefaults(portableCustomDriver),
  position_object: withDriverDefaults(positionObjectDriver),
  select_point: withDriverDefaults(selectPointDriver),
  slider: withDriverDefaults(sliderDriver),
  upload: withDriverDefaults(uploadDriver),
  hotspot: withDriverDefaults(hotspotDriver),
  hottext: withDriverDefaults(hottextDriver),
  custom_interaction: withDriverDefaults(customInteractionDriver),
  drawing: withDriverDefaults(drawingDriver),
  end_attempt: withDriverDefaults(endAttemptDriver),
} as const;

/** Validate explicit point configuration before any driver can replace generated processing. */
export function questionPointsErrors(draft: Draft): string[] {
  if (draft.maximumScore === undefined) return [];
  if (!draft.type || !TYPE_DRIVERS[draft.type].capabilities?.points) {
    return ['This question type does not support explicit points.'];
  }
  if (!Number.isFinite(draft.maximumScore) || draft.maximumScore < 0) {
    return ['Points must be a finite non-negative number.'];
  }
  if (draft.responseMode === 'custom' || draft.customResponseProcessingXml) {
    return ['Explicit points cannot replace custom scoring.'];
  }
  if (draft.type === 'inline_choice' && draft.responseMode === 'partial') {
    return ['Explicit dropdown points require all-or-nothing scoring.'];
  }
  return [];
}

/** Hydrate a base draft through the exact driver selected by its question type. */
export function hydrateDriverDraft<K extends QuestionTypeId>(
  typeId: K,
  draft: Draft,
): DriverDraft<K> {
  // SAFETY: TYPE_DRIVERS preserves the same key-to-draft relationship as DRIVER_MAP.
  return TYPE_DRIVERS[typeId].hydrate(draft) as DriverDraft<K>;
}

/** Serialize one exact hydrated driver draft back to the persistence draft shape. */
export function serializeDriverDraft<K extends QuestionTypeId>(
  typeId: K,
  draft: DriverDraft<K>,
): Draft {
  return TYPE_DRIVERS[typeId].serialize(draft);
}

export const QUESTION_TYPES = QUESTION_TYPE_IDS.map((id) => {
  const driver = TYPE_DRIVERS[id];
  return { id, label: driver.label };
});

export function labelForTypeId(id: string | undefined | null): string {
  if (!id) return 'Question';
  const found = QUESTION_TYPES.find((t) => t.id === id);
  return found?.label ?? 'Question';
}
