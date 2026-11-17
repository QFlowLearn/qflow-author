import type { QtiInteractionVocabulary } from '../../../lib/shared_vocabulary.ts';
import type { MediaKind } from '../../../lib/types/media.ts';
import type { ItemLanguage } from '../../../lib/types/item_language.ts';
import type { PortableInteractionModule } from '../../../lib/types/portable_custom.ts';
import type { QuestionTypeId } from '../../../lib/types/registry.ts';

/** Closed settings values shared between the item editor and question settings rail. */
export type DriverSettingsValues = {
  readonly itemLanguage?: ItemLanguage;
  readonly shuffle?: boolean;
  readonly allowPins?: boolean;
  readonly minChoices?: number;
  readonly maxChoices?: number;
  readonly selectionMinMessage?: string;
  readonly selectionMaxMessage?: string;
  readonly responseMode?: 'all_or_nothing' | 'partial' | 'custom';
  readonly required?: boolean;
  readonly answerMasking?: boolean;
  readonly textEntryShowIdentifiers?: boolean;
  readonly requirePattern?: boolean;
  readonly sharedVocabulary?: QtiInteractionVocabulary;
  readonly matchMinAssociations?: number;
  readonly matchMaxAssociations?: number;
  readonly gapMinAssociations?: number;
  readonly gapMaxAssociations?: number;
  readonly gapMinMessage?: string;
  readonly gapMaxMessage?: string;
  readonly extendedExpectedLength?: number;
  readonly extendedExpectedLines?: number;
  readonly extendedPlaceholderText?: string;
  readonly extendedFormat?: 'plain' | 'preformatted' | 'xhtml';
  readonly extendedHeightClass?: string;
  readonly extendedCounterType?: 'none' | 'up' | 'down';
  readonly extendedMinStrings?: number;
  readonly extendedMaxStrings?: number;
  readonly extendedPatternMask?: string;
  readonly extendedPatternMessage?: string;
  readonly extendedStringIdentifier?: string;
  readonly uploadMaxFileSize?: number;
  readonly uploadFileTypes?: string;
  readonly uploadMultiple?: boolean;
  readonly mediaKind?: MediaKind;
  readonly mediaInteractionLabel?: string;
  readonly mediaObjectLabel?: string;
  readonly mediaAutostart?: boolean;
  readonly mediaLoop?: boolean;
  readonly mediaMinPlays?: number;
  readonly mediaMaxPlays?: number;
  readonly mediaCoords?: string;
  readonly mediaWidth?: number;
  readonly mediaHeight?: number;
  readonly sliderStepLabel?: boolean;
  readonly sliderReverse?: boolean;
  readonly portableModule?: string;
  readonly portableClassName?: string;
  readonly portableLabel?: string;
  readonly portableBaseType?: string;
  readonly portableCardinality?: 'single' | 'multiple' | 'ordered' | 'record';
  readonly portableModulesPrimaryConfiguration?: string;
  readonly portableModulesSecondaryConfiguration?: string;
  readonly portableInteractionModules?: ReadonlyArray<PortableInteractionModule>;
};

/** Type-identified settings snapshot or patch exchanged across the editor boundary. */
export type DriverSettingsUpdate = {
  readonly typeId: QuestionTypeId;
  readonly values: DriverSettingsValues;
};
