import type { VNode } from 'preact';
import type { QtiMediaPlayerControls } from '../../../lib/shared_vocabulary.ts';
import type { PortableInteractionModule } from '../../../lib/types/portable_custom.ts';
import type { ItemLanguage, ItemLanguageCommitResult } from '../../../lib/types/item_language.ts';

/** Optional boolean setting exposed by the question-settings rail. */
export type ToggleControl =
  | { readonly value: boolean; readonly onChange: (next: boolean) => void }
  | undefined;

/** Optional numeric setting exposed by the question-settings rail. */
export type NumberControl =
  | { readonly value?: number; readonly onChange: (next?: number) => void; readonly issue?: string }
  | undefined;

/** Optional text setting exposed by the question-settings rail. */
export type TextControl =
  | { readonly value: string; readonly onChange: (next: string) => void }
  | undefined;

/** One selectable value in a question-settings control. */
export type SelectOption = {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
};

/** Optional single-value selector exposed by the question-settings rail. */
export type SelectControl = {
  readonly value: string;
  readonly options: ReadonlyArray<SelectOption>;
  readonly onChange: (next: string) => void;
} | undefined;
export type ItemLanguageMessages = {
  readonly label: string;
  readonly help: string;
  readonly required: string;
  readonly invalid: string;
};

export type ItemLanguageControl = {
  readonly value: ItemLanguage;
  readonly onCommit: (next: string) => ItemLanguageCommitResult;
  readonly messages: ItemLanguageMessages;
};

/** Optional selector for QTI media-player controls. */
export type MediaPlayerControlsControl = {
  readonly value: ReadonlyArray<QtiMediaPlayerControls>;
  readonly options: ReadonlyArray<
    { readonly value: QtiMediaPlayerControls; readonly label: string }
  >;
  readonly onChange: (token: QtiMediaPlayerControls, enabled: boolean) => void;
} | undefined;

/** Portable-interaction module list editable from the settings rail. */
export type ModuleListControl = {
  readonly value: ReadonlyArray<PortableInteractionModule>;
  readonly onChange: (next: PortableInteractionModule[]) => void;
};

/** One rendered section in a driver's question-settings rail. */
export type RightRailSection = {
  readonly id: string;
  readonly group: 'answer' | 'scoring' | 'accessibility' | 'details';
  readonly content: VNode;
};

/** Fully typed browser controls supplied to every question driver's settings view. */
export type RightRailControls = {
  readonly sections: ReadonlyArray<RightRailSection>;
  required?: ToggleControl;
  answerMasking?: ToggleControl;
  minChoices?: NumberControl;
  maxChoices?: NumberControl;
  selectionMinMessage?: TextControl;
  selectionMaxMessage?: TextControl;
  minAssociations?: NumberControl;
  maxAssociations?: NumberControl;
  associationLimitHelp?: string;
  gapMinAssociations?: NumberControl;
  gapMaxAssociations?: NumberControl;
  gapMinMessage?: TextControl;
  gapMaxMessage?: TextControl;
  shuffle?: ToggleControl;
  allowPins?: ToggleControl;
  sliderStepLabel?: ToggleControl;
  sliderReverse?: ToggleControl;
  textEntryShowIdentifiers?: ToggleControl;
  textEntryRequirePattern?: ToggleControl;
  extendedExpectedLength?: NumberControl;
  extendedExpectedLines?: NumberControl;
  extendedPlaceholderText?: TextControl;
  extendedFormat?: SelectControl;
  extendedHeightClass?: SelectControl;
  extendedCounterType?: SelectControl;
  extendedMinStrings?: NumberControl;
  extendedMaxStrings?: NumberControl;
  extendedPatternMask?: TextControl;
  extendedPatternMessage?: TextControl;
  extendedStringIdentifier?: TextControl;
  responseMode?: SelectControl;
  itemLanguage?: ItemLanguageControl;
  uploadMaxFileSize?: NumberControl;
  uploadFileTypes?: TextControl;
  uploadMultiple?: ToggleControl;
  mediaInteractionLabel?: TextControl;
  mediaAutostart?: ToggleControl;
  mediaLoop?: ToggleControl;
  mediaMinPlays?: NumberControl;
  mediaMaxPlays?: NumberControl;
  mediaCoords?: TextControl;
  mediaWidth?: NumberControl;
  mediaHeight?: NumberControl;
  mediaPlayerControls?: MediaPlayerControlsControl;
  mediaPauseDelay?: NumberControl;
  mediaPauseDuration?: NumberControl;
  sharedLabelStyle?: SelectControl;
  sharedLabelSuffix?: SelectControl;
  sharedOrientation?: SelectControl;
  sharedChoicesStacking?: SelectControl;
  sharedChoicesPosition?: SelectControl;
  sharedChoicesContainerWidth?: NumberControl;
  sharedSelectionTone?: SelectControl;
  sharedInputControlHidden?: ToggleControl;
  sharedUnselectedHidden?: ToggleControl;
  sharedWritingOrientation?: SelectControl;
  sharedMatchTabular?: ToggleControl;
  sharedMatchHeaderHidden?: ToggleControl;
  sharedMatchFirstColumnHeader?: TextControl;
  sharedGapPlacement?: ToggleControl;
  portableModule?: TextControl;
  portableClassName?: TextControl;
  portableLabel?: TextControl;
  portableBaseType?: TextControl;
  portableCardinality?: SelectControl;
  portableModulesPrimaryConfiguration?: TextControl;
  portableModulesSecondaryConfiguration?: TextControl;
  portableInteractionModules?: ModuleListControl;
};

/** Props accepted by every question driver's settings-rail component. */
export type DriverRightRailProps = {
  readonly controls: RightRailControls;
};
