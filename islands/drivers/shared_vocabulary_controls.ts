import type { QuestionTypeId } from '../../lib/types/registry.ts';
import {
  MEDIA_PLAYER_CONTROL_CHOICES,
  type QtiMediaPlayerControls,
  toggleMediaPlayerControl,
} from '../../lib/media_vocabulary.ts';
import {
  applySharedVocabularyPatch,
  CHOICE_STACKING_OPTIONS,
  CHOICES_POSITION_OPTIONS,
  LABEL_STYLE_OPTIONS,
  LABEL_SUFFIX_OPTIONS,
  ORIENTATION_OPTIONS,
  parseVocabularyStacking,
  parseVocabularyToken,
  QTI_CHOICES_POSITIONS,
  QTI_LABEL_STYLES,
  QTI_LABEL_SUFFIXES,
  QTI_ORIENTATIONS,
  QTI_SELECTION_TONES,
  QTI_WRITING_ORIENTATIONS,
  type QtiInteractionVocabulary,
  SELECTION_TONE_OPTIONS,
  SHARED_VOCABULARY_INTERACTION_DEFINITIONS,
  sharedVocabularyFieldAppliesToType,
  type SharedVocabularyInteractionDefinition,
  type SharedVocabularyProperty,
  WRITING_ORIENTATION_OPTIONS,
} from '../../lib/shared_vocabulary.ts';
import type { MediaPlayerControlsControl } from './right_rail.tsx';
import type { RightRailControls } from './right_rail.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';

export type { MediaPlayerControlsControl };

export type SharedVocabularyPatch =
  | Partial<QtiInteractionVocabulary>
  | ((current: QtiInteractionVocabulary) => Partial<QtiInteractionVocabulary>);

export type SharedVocabularyControlKey =
  | 'sharedLabelStyle'
  | 'sharedLabelSuffix'
  | 'sharedOrientation'
  | 'sharedChoicesStacking'
  | 'sharedChoicesPosition'
  | 'sharedChoicesContainerWidth'
  | 'sharedSelectionTone'
  | 'sharedInputControlHidden'
  | 'sharedUnselectedHidden'
  | 'sharedWritingOrientation'
  | 'sharedMatchTabular'
  | 'sharedMatchHeaderHidden'
  | 'sharedMatchFirstColumnHeader'
  | 'sharedGapPlacement'
  | 'mediaPlayerControls'
  | 'mediaPauseDelay'
  | 'mediaPauseDuration';

type SharedVocabularySectionKey = Exclude<
  SharedVocabularyControlKey,
  'mediaPlayerControls' | 'mediaPauseDelay' | 'mediaPauseDuration'
>;

type SharedVocabularyControls = Partial<Pick<RightRailControls, SharedVocabularyControlKey>>;

const VOCABULARY_MESSAGE_IDS = {
  '': 'driver.rightRail.vocabulary.default',
  none: 'driver.rightRail.vocabulary.none',
  decimal: 'driver.rightRail.vocabulary.decimal',
  'cjk-ideographic': 'driver.rightRail.vocabulary.cjkIdeographic',
  'lower-alpha': 'driver.rightRail.vocabulary.lowerAlpha',
  'upper-alpha': 'driver.rightRail.vocabulary.upperAlpha',
  period: 'driver.rightRail.vocabulary.period',
  parenthesis: 'driver.rightRail.vocabulary.parenthesis',
  horizontal: 'driver.rightRail.vocabulary.horizontal',
  vertical: 'driver.rightRail.vocabulary.vertical',
  top: 'driver.rightRail.vocabulary.top',
  bottom: 'driver.rightRail.vocabulary.bottom',
  left: 'driver.rightRail.vocabulary.left',
  right: 'driver.rightRail.vocabulary.right',
  light: 'driver.rightRail.vocabulary.light',
  dark: 'driver.rightRail.vocabulary.dark',
  'vertical-lr': 'driver.rightRail.vocabulary.verticalLr',
  'vertical-rl': 'driver.rightRail.vocabulary.verticalRl',
  '1': 'driver.rightRail.vocabulary.stacking1',
  '2': 'driver.rightRail.vocabulary.stacking2',
  '3': 'driver.rightRail.vocabulary.stacking3',
  '4': 'driver.rightRail.vocabulary.stacking4',
  '5': 'driver.rightRail.vocabulary.stacking5',
} as const;

const MEDIA_MESSAGE_IDS = {
  none: 'driver.rightRail.mediaControl.none',
  default: 'driver.rightRail.mediaControl.default',
  play: 'driver.rightRail.mediaControl.play',
  rewind: 'driver.rightRail.mediaControl.rewind',
  captions: 'driver.rightRail.mediaControl.captions',
  audioDescription: 'driver.rightRail.mediaControl.audioDescription',
} as const satisfies Record<QtiMediaPlayerControls, string>;

const SHARED_VOCABULARY_KEY_BY_PROPERTY = {
  labelStyle: 'sharedLabelStyle',
  labelSuffix: 'sharedLabelSuffix',
  orientation: 'sharedOrientation',
  choicesStacking: 'sharedChoicesStacking',
  choicesPosition: 'sharedChoicesPosition',
  choicesContainerWidth: 'sharedChoicesContainerWidth',
  selectionTone: 'sharedSelectionTone',
  inputControlHidden: 'sharedInputControlHidden',
  unselectedHidden: 'sharedUnselectedHidden',
  writingOrientation: 'sharedWritingOrientation',
  matchTabular: 'sharedMatchTabular',
  matchHeaderHidden: 'sharedMatchHeaderHidden',
  matchFirstColumnHeader: 'sharedMatchFirstColumnHeader',
  gapPlacement: 'sharedGapPlacement',
  mediaPlayerControls: 'mediaPlayerControls',
  mediaPauseDelay: 'mediaPauseDelay',
  mediaPauseDuration: 'mediaPauseDuration',
} satisfies Partial<Record<SharedVocabularyProperty, SharedVocabularyControlKey>>;

type ControlledSharedVocabularyProperty = keyof typeof SHARED_VOCABULARY_KEY_BY_PROPERTY;

type FieldDef<K extends SharedVocabularyControlKey = SharedVocabularyControlKey> = {
  def: SharedVocabularyInteractionDefinition & { property: ControlledSharedVocabularyProperty };
  key: K;
  build: (
    sv: QtiInteractionVocabulary,
    setSharedVocabulary: (patch: SharedVocabularyPatch) => void,
  ) => NonNullable<RightRailControls[K]>;
};

const SHARED_VOCABULARY_BUILDERS: {
  [K in SharedVocabularyControlKey]: FieldDef<K>['build'];
} = {
  sharedLabelStyle: (sv, set) => ({
    value: sv.labelStyle ?? '',
    options: LABEL_STYLE_OPTIONS,
    onChange: (next: string) => set({ labelStyle: parseVocabularyToken(next, QTI_LABEL_STYLES) }),
  }),
  sharedLabelSuffix: (sv, set) => ({
    value: sv.labelSuffix ?? '',
    options: LABEL_SUFFIX_OPTIONS,
    onChange: (next: string) =>
      set({ labelSuffix: parseVocabularyToken(next, QTI_LABEL_SUFFIXES) }),
  }),
  sharedOrientation: (sv, set) => ({
    value: sv.orientation ?? '',
    options: ORIENTATION_OPTIONS,
    onChange: (next: string) => set({ orientation: parseVocabularyToken(next, QTI_ORIENTATIONS) }),
  }),
  sharedChoicesStacking: (sv, set) => ({
    value: sv.choicesStacking ? String(sv.choicesStacking) : '',
    options: CHOICE_STACKING_OPTIONS,
    onChange: (next: string) => set({ choicesStacking: parseVocabularyStacking(next) }),
  }),
  sharedChoicesPosition: (sv, set) => ({
    value: sv.choicesPosition ?? '',
    options: CHOICES_POSITION_OPTIONS,
    onChange: (next: string) =>
      set({ choicesPosition: parseVocabularyToken(next, QTI_CHOICES_POSITIONS) }),
  }),
  sharedChoicesContainerWidth: (sv, set) => ({
    value: sv.choicesContainerWidth,
    onChange: (next?: number) => set({ choicesContainerWidth: next }),
  }),
  sharedSelectionTone: (sv, set) => ({
    value: sv.selectionTone ?? '',
    options: SELECTION_TONE_OPTIONS,
    onChange: (next: string) =>
      set({ selectionTone: parseVocabularyToken(next, QTI_SELECTION_TONES) }),
  }),
  sharedInputControlHidden: (sv, set) => ({
    value: Boolean(sv.inputControlHidden),
    onChange: (next: boolean) => set({ inputControlHidden: next || undefined }),
  }),
  sharedUnselectedHidden: (sv, set) => ({
    value: Boolean(sv.unselectedHidden),
    onChange: (next: boolean) => set({ unselectedHidden: next || undefined }),
  }),
  sharedWritingOrientation: (sv, set) => ({
    value: sv.writingOrientation ?? '',
    options: WRITING_ORIENTATION_OPTIONS,
    onChange: (next: string) =>
      set({ writingOrientation: parseVocabularyToken(next, QTI_WRITING_ORIENTATIONS) }),
  }),
  sharedMatchTabular: (sv, set) => ({
    value: Boolean(sv.matchTabular),
    onChange: (next: boolean) => set({ matchTabular: next || undefined }),
  }),
  sharedMatchHeaderHidden: (sv, set) => ({
    value: Boolean(sv.matchHeaderHidden),
    onChange: (next: boolean) => set({ matchHeaderHidden: next || undefined }),
  }),
  sharedMatchFirstColumnHeader: (sv, set) => ({
    value: sv.matchFirstColumnHeader ?? '',
    onChange: (next: string) => set({ matchFirstColumnHeader: next || undefined }),
  }),
  sharedGapPlacement: (sv, set) => ({
    value: Boolean(sv.gapPlacement),
    onChange: (next: boolean) => set({ gapPlacement: next || undefined }),
  }),
  mediaPlayerControls: (sv, set) => ({
    value: sv.mediaPlayerControls ?? [],
    options: MEDIA_PLAYER_CONTROL_CHOICES,
    onChange: (token: QtiMediaPlayerControls, enabled: boolean) =>
      set((current) => ({
        mediaPlayerControls: toggleMediaPlayerControl(
          current.mediaPlayerControls,
          token,
          enabled,
        ),
      })),
  }),
  mediaPauseDelay: (sv, set) => ({
    value: sv.mediaPauseDelay,
    onChange: (next?: number) => set({ mediaPauseDelay: next }),
  }),
  mediaPauseDuration: (sv, set) => ({
    value: sv.mediaPauseDuration,
    onChange: (next?: number) => set({ mediaPauseDuration: next }),
  }),
};

const SHARED_VOCABULARY_FIELDS = SHARED_VOCABULARY_INTERACTION_DEFINITIONS.flatMap((def) => {
  if (!hasSharedVocabularyControl(def)) return [];
  const key = SHARED_VOCABULARY_KEY_BY_PROPERTY[def.property];
  return [{
    def,
    key,
    build: SHARED_VOCABULARY_BUILDERS[key],
  }];
});

const SHARED_VOCABULARY_SECTION_KEYS = [
  'sharedLabelStyle',
  'sharedLabelSuffix',
  'sharedOrientation',
  'sharedChoicesStacking',
  'sharedChoicesPosition',
  'sharedChoicesContainerWidth',
  'sharedSelectionTone',
  'sharedInputControlHidden',
  'sharedUnselectedHidden',
  'sharedWritingOrientation',
  'sharedMatchTabular',
  'sharedMatchHeaderHidden',
  'sharedMatchFirstColumnHeader',
  'sharedGapPlacement',
] as const satisfies readonly SharedVocabularySectionKey[];

export function hasSharedVocabularyControls(
  controls: Pick<RightRailControls, SharedVocabularySectionKey>,
): boolean {
  return SHARED_VOCABULARY_SECTION_KEYS.some((key) => Boolean(controls[key]));
}

export function buildSharedVocabularyControls(
  typeId: QuestionTypeId,
  sharedVocabulary: QtiInteractionVocabulary | undefined,
  setSharedVocabulary: (patch: SharedVocabularyPatch) => void,
  t: I18n['t'],
): SharedVocabularyControls {
  const sv = sharedVocabulary ?? {};
  const set = (patch: SharedVocabularyPatch) => setSharedVocabulary(patch);
  const controls: SharedVocabularyControls = {};
  for (const field of SHARED_VOCABULARY_FIELDS) {
    if (!sharedVocabularyFieldAppliesToType(typeId, field.def)) continue;
    const built = field.build(sv, set);
    if ('options' in built) {
      Object.assign(built, {
        options: built.options.map((option) => ({
          ...option,
          label: t(
            field.key === 'mediaPlayerControls'
              ? MEDIA_MESSAGE_IDS[option.value as QtiMediaPlayerControls]
              : VOCABULARY_MESSAGE_IDS[option.value as keyof typeof VOCABULARY_MESSAGE_IDS],
          ),
        })),
      });
    }
    Object.assign(controls, { [field.key]: built });
  }
  return controls;
}

function hasSharedVocabularyControl(
  def: SharedVocabularyInteractionDefinition,
): def is SharedVocabularyInteractionDefinition & { property: ControlledSharedVocabularyProperty } {
  return def.property in SHARED_VOCABULARY_KEY_BY_PROPERTY;
}

export function createSharedVocabularyUpdater(
  getCurrent: () => QtiInteractionVocabulary | undefined,
  update: (next: QtiInteractionVocabulary | undefined) => void,
): (patch: SharedVocabularyPatch) => void {
  return (patch) => {
    const current = getCurrent();
    const resolved = typeof patch === 'function' ? patch(current ?? {}) : patch;
    update(applySharedVocabularyPatch(current, resolved));
  };
}
