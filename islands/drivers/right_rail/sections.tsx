import type { FunctionalComponent } from 'preact';
import Button from '../../../components/ui/Button.tsx';
import InfoTooltip from '../../../components/ui/InfoTooltip.tsx';
import Select from '../../../components/ui/Select.tsx';
import type { PortableInteractionModule } from '../../../lib/types/portable_custom.ts';
import {
  MediaPlayerControlsField,
  NumberField,
  SelectField,
  TextField,
  ToggleField,
} from './fields.tsx';
import { hasSharedVocabularyControls } from '../shared_vocabulary_controls.ts';
import type { RightRailControls } from './types.ts';
import { useI18n } from '../../../lib/i18n/context.tsx';

export { ItemLanguageSection, ShuffleSection } from './basic_sections.tsx';

type SectionProps = { controls: RightRailControls };

export const SingleSelectSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  if (!controls.required && !controls.answerMasking) return null;
  return (
    <>
      <ToggleField label={t('driver.rightRail.required')} control={controls.required} />
      <ToggleField
        label={t('driver.rightRail.answerMasking')}
        control={controls.answerMasking}
        tooltip={t('driver.rightRail.answerMaskingHelp')}
      />
    </>
  );
};

export const MultiSelectSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  const hasMessages = Boolean(controls.selectionMinMessage || controls.selectionMaxMessage);
  if (!controls.minChoices && !controls.maxChoices && !hasMessages) return null;
  const helperText = t('driver.rightRail.selectionHelp');
  const minSummary = controls.minChoices?.value ?? 0;
  const maxRaw = controls.maxChoices?.value;
  const maxSummary = maxRaw == null || maxRaw === 0 ? 'unlimited' : String(maxRaw);
  return (
    <div class='space-y-2 rounded-lg border border-base-300/80 bg-base-100/70 p-2.5'>
      <div class='flex flex-wrap items-center justify-between gap-2'>
        <span class='text-xs font-medium uppercase tracking-wide text-base-content/60'>
          {t('driver.rightRail.selectionConstraints')}
        </span>
        <span class='rounded border border-base-300 bg-base-200 px-1.5 py-0.5 text-[10px] font-medium text-base-content/80'>
          {t('driver.rightRail.minMaxSummary', { min: minSummary, max: maxSummary })}
        </span>
      </div>
      <NumberField
        field='minChoices'
        label={t('driver.rightRail.minimumSelections')}
        control={controls.minChoices}
        min={0}
        placeholder={t('driver.rightRail.exampleOne')}
        tooltip={helperText}
        hint={t('driver.rightRail.noMinimumHint')}
      />
      <NumberField
        field='maxChoices'
        label={t('driver.rightRail.maximumSelections')}
        control={controls.maxChoices}
        min={0}
        placeholder={t('driver.rightRail.zeroUnlimited')}
        tooltip={!controls.minChoices ? helperText : undefined}
        hint={t('driver.rightRail.unlimitedChoicesHint')}
      />
      <TextField
        label={t('driver.rightRail.minimumSelectionsError')}
        control={controls.selectionMinMessage}
        placeholder={t('driver.rightRail.shownTooFew')}
      />
      <TextField
        label={t('driver.rightRail.maximumSelectionsError')}
        control={controls.selectionMaxMessage}
        placeholder={t('driver.rightRail.shownTooMany')}
      />
    </div>
  );
};

export const OrderSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  const hasMinMax = Boolean(controls.minChoices || controls.maxChoices);
  if (!hasMinMax) return null;
  const helperText = t('driver.rightRail.orderHelp');
  return (
    <div class='space-y-1'>
      <NumberField
        field='minChoices'
        label={t('driver.rightRail.minimumOrder')}
        control={controls.minChoices}
        min={0}
        placeholder={t('driver.rightRail.exampleOne')}
        tooltip={controls.minChoices ? helperText : undefined}
      />
      <NumberField
        field='maxChoices'
        label={t('driver.rightRail.maximumOrder')}
        control={controls.maxChoices}
        min={0}
        placeholder='0 (unlimited)'
        tooltip={!controls.minChoices && controls.maxChoices ? helperText : undefined}
      />
    </div>
  );
};

export const SliderSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  if (!controls.sliderStepLabel && !controls.sliderReverse) return null;
  return (
    <div class='space-y-2 rounded-lg border border-base-300/80 bg-base-100/70 p-2.5'>
      <div class='text-xs font-medium uppercase tracking-wide text-base-content/60'>
        {t('driver.rightRail.display')}
      </div>
      <ToggleField
        label={t('driver.rightRail.stepLabels')}
        control={controls.sliderStepLabel}
        tooltip={t('driver.rightRail.stepLabelsHelp')}
      />
      <ToggleField
        label={t('driver.rightRail.reverseDirection')}
        control={controls.sliderReverse}
        tooltip={t('driver.rightRail.reverseDirectionHelp')}
      />
    </div>
  );
};

export const MatchSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  if (!controls.minAssociations && !controls.maxAssociations) return null;
  const helperText = t('driver.rightRail.matchHelp');
  const contextualHelp = controls.associationLimitHelp ??
    t('driver.rightRail.matchRowHelp');
  const minSummary = controls.minAssociations?.value ?? 0;
  const maxRaw = controls.maxAssociations?.value;
  const maxSummary = maxRaw == null || maxRaw === 0 ? 'unlimited' : String(maxRaw);
  const hasInvalidBounds = typeof maxRaw === 'number' && maxRaw > 0 && minSummary > maxRaw;
  return (
    <div class='space-y-2 rounded-lg border border-base-300/80 bg-base-100/70 p-2.5'>
      <div class='flex flex-wrap items-center justify-between gap-2'>
        <span class='text-xs font-medium uppercase tracking-wide text-base-content/60'>
          {t('driver.rightRail.associationConstraints')}
        </span>
        <span class='rounded border border-base-300 bg-base-200 px-1.5 py-0.5 text-[10px] font-medium text-base-content/80'>
          {t('driver.rightRail.minMaxSummary', { min: minSummary, max: maxSummary })}
        </span>
      </div>
      <p class='text-xs text-base-content/65'>{contextualHelp}</p>
      <NumberField
        label={t('driver.rightRail.minimumPairs')}
        control={controls.minAssociations}
        min={0}
        placeholder='0'
        tooltip={helperText}
        hint={t('driver.rightRail.noMinimumPairsHint')}
      />
      <NumberField
        label={t('driver.rightRail.maximumPairs')}
        control={controls.maxAssociations}
        min={0}
        placeholder='0'
        tooltip={!controls.minAssociations ? helperText : undefined}
        hint={t('driver.rightRail.noMaximumPairsHint')}
      />
      {hasInvalidBounds && (
        <p class='text-xs font-medium text-error'>
          {t('driver.rightRail.invalidPairBounds')}
        </p>
      )}
    </div>
  );
};

export const GapMatchSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  const hasMin = Boolean(controls.gapMinAssociations);
  const hasMax = Boolean(controls.gapMaxAssociations);
  const hasMsgs = Boolean(controls.gapMinMessage || controls.gapMaxMessage);
  if (!hasMin && !hasMax && !hasMsgs) return null;
  const helperText = t('driver.rightRail.gapMatchHelp');
  return (
    <div class='space-y-1'>
      <NumberField
        label={t('driver.rightRail.gapMinimumAssociations')}
        control={controls.gapMinAssociations}
        min={0}
        tooltip={controls.gapMinAssociations ? helperText : undefined}
      />
      <NumberField
        label={t('driver.rightRail.gapMaximumAssociations')}
        control={controls.gapMaxAssociations}
        min={0}
        tooltip={!controls.gapMinAssociations && controls.gapMaxAssociations
          ? helperText
          : undefined}
      />
      <TextField
        label={t('driver.rightRail.gapMinimumSelectionsError')}
        control={controls.gapMinMessage}
        placeholder={t('driver.rightRail.gapMinimumSelectionsShown')}
        tooltip={!controls.gapMinAssociations && !controls.gapMaxAssociations
          ? helperText
          : undefined}
      />
      <TextField
        label={t('driver.rightRail.gapMaximumSelectionsError')}
        control={controls.gapMaxMessage}
        placeholder={t('driver.rightRail.gapMaximumSelectionsShown')}
        tooltip={!controls.gapMinAssociations && !controls.gapMaxAssociations &&
            !controls.gapMinMessage
          ? helperText
          : undefined}
      />
    </div>
  );
};

export const GraphicGapMatchSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const hasAssoc = Boolean(
    controls.gapMinAssociations || controls.gapMaxAssociations || controls.gapMinMessage ||
      controls.gapMaxMessage,
  );
  if (!hasAssoc) return null;
  return (
    <div class='space-y-2'>
      <GapMatchSection controls={controls} />
    </div>
  );
};

export const TextEntrySection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  if (!controls.textEntryShowIdentifiers && !controls.textEntryRequirePattern) return null;
  return (
    <div class='space-y-1'>
      <ToggleField
        label={t('driver.rightRail.textEntryShowIdentifiers')}
        control={controls.textEntryShowIdentifiers}
      />
      <ToggleField
        label={t('driver.rightRail.textEntryRequirePattern')}
        control={controls.textEntryRequirePattern}
        tooltip={t('driver.rightRail.textEntryRequirePatternHelp')}
      />
    </div>
  );
};

export const ExtendedTextSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  const hasCore = Boolean(
    controls.extendedExpectedLength || controls.extendedExpectedLines ||
      controls.extendedPlaceholderText || controls.extendedFormat || controls.extendedHeightClass ||
      controls.extendedCounterType,
  );
  const hasValidation = Boolean(
    controls.extendedMinStrings || controls.extendedMaxStrings || controls.extendedPatternMask ||
      controls.extendedPatternMessage || controls.extendedStringIdentifier,
  );
  if (!hasCore && !hasValidation) return null;
  const helperText = t('driver.rightRail.extendedHelp');
  return (
    <div class='space-y-3'>
      {hasCore && (
        <div class='space-y-2 rounded-lg border border-base-300/80 bg-base-100/70 p-2.5'>
          <div class='text-xs font-medium uppercase tracking-wide text-base-content/60'>
            {t('driver.rightRail.responseBox')}
          </div>
          <NumberField
            label={t('driver.rightRail.expectedLength')}
            control={controls.extendedExpectedLength}
            min={1}
            placeholder={t('driver.rightRail.example200')}
          />
          <NumberField
            label={t('driver.rightRail.expectedLines')}
            control={controls.extendedExpectedLines}
            min={1}
            placeholder={t('driver.rightRail.exampleSix')}
          />
          <TextField
            label={t('driver.rightRail.placeholderText')}
            control={controls.extendedPlaceholderText}
            placeholder={t('driver.rightRail.placeholderShown')}
          />
          <SelectField
            label={t('driver.rightRail.responseFormat')}
            control={controls.extendedFormat}
            tooltip={controls.extendedFormat ? helperText : undefined}
          />
          <SelectField
            label={t('driver.rightRail.textareaHeight')}
            control={controls.extendedHeightClass}
          />
          <SelectField
            label={t('driver.rightRail.counter')}
            control={controls.extendedCounterType}
            tooltip={!controls.extendedFormat && controls.extendedCounterType
              ? helperText
              : undefined}
          />
        </div>
      )}
      {hasValidation && (
        <div class='space-y-2 rounded-lg border border-base-300/80 bg-base-100/70 p-2.5'>
          <div class='text-xs font-medium uppercase tracking-wide text-base-content/60'>
            {t('driver.rightRail.validation')}
          </div>
          <NumberField
            label={t('driver.rightRail.minimumResponses')}
            control={controls.extendedMinStrings}
            min={0}
            placeholder='0'
          />
          <NumberField
            label={t('driver.rightRail.maximumResponses')}
            control={controls.extendedMaxStrings}
            min={1}
            placeholder='1'
          />
          <TextField
            label={t('driver.rightRail.patternMask')}
            control={controls.extendedPatternMask}
            placeholder='Regex, e.g., [A-Za-z\\s]+'
          />
          <TextField
            label={t('driver.rightRail.patternMessage')}
            control={controls.extendedPatternMessage}
            placeholder={t('driver.rightRail.patternShown')}
          />
          <TextField
            label={t('driver.rightRail.stringIdentifier')}
            control={controls.extendedStringIdentifier}
            placeholder={t('driver.rightRail.stringIdentifierHelp')}
          />
        </div>
      )}
    </div>
  );
};

export const UploadSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  if (!controls.uploadMaxFileSize && !controls.uploadFileTypes && !controls.uploadMultiple) {
    return null;
  }
  return (
    <div class='space-y-2 rounded-lg border border-base-300/80 bg-base-100/70 p-2.5'>
      <div class='text-xs font-medium uppercase tracking-wide text-base-content/60'>
        {t('driver.rightRail.uploadConstraints')}
      </div>
      <NumberField
        label={t('driver.rightRail.maxFileSize')}
        control={controls.uploadMaxFileSize}
        min={1}
        placeholder={t('driver.rightRail.optional')}
      />
      <TextField
        label={t('driver.rightRail.allowedFileTypes')}
        control={controls.uploadFileTypes}
        placeholder={t('driver.rightRail.fileTypesExample')}
      />
      <ToggleField
        label={t('driver.rightRail.allowMultipleFiles')}
        control={controls.uploadMultiple}
      />
    </div>
  );
};

export const ScoringSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  const control = controls.responseMode;
  if (!control) return null;
  const selected = control.options.find((opt) => opt.value === control.value);
  return (
    <label>
      <span class='inline-flex items-center gap-2'>
        {t('driver.rightRail.scoringTemplate')}
        {selected?.description && <InfoTooltip text={selected.description} />}
      </span>
      <Select
        aria-label={t('driver.rightRail.scoringTemplate')}
        value={control.value}
        onInput={(e) => control.onChange((e.target as HTMLSelectElement).value)}
      >
        {control.options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </Select>
    </label>
  );
};

export const MediaSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  const hasMedia = Boolean(
    controls.mediaInteractionLabel || controls.mediaAutostart ||
      controls.mediaLoop || controls.mediaMinPlays || controls.mediaMaxPlays ||
      controls.mediaCoords || controls.mediaWidth || controls.mediaHeight ||
      controls.mediaPlayerControls || controls.mediaPauseDelay || controls.mediaPauseDuration,
  );
  if (!hasMedia) return null;
  const helperText = t('driver.rightRail.mediaHelp');
  return (
    <div class='space-y-1'>
      <TextField
        label={t('driver.rightRail.mediaInteractionLabel')}
        control={controls.mediaInteractionLabel}
        placeholder='mediaButton'
        tooltip={controls.mediaInteractionLabel ? helperText : undefined}
      />
      <ToggleField
        label={t('driver.rightRail.mediaAutostart')}
        control={controls.mediaAutostart}
        tooltip={!controls.mediaInteractionLabel && controls.mediaAutostart
          ? helperText
          : undefined}
      />
      <ToggleField
        label={t('driver.rightRail.mediaLoop')}
        control={controls.mediaLoop}
        tooltip={!controls.mediaInteractionLabel && !controls.mediaAutostart && controls.mediaLoop
          ? helperText
          : undefined}
      />
      <NumberField
        label={t('driver.rightRail.mediaMinPlays')}
        control={controls.mediaMinPlays}
        min={0}
        tooltip={!controls.mediaInteractionLabel && !controls.mediaAutostart &&
            !controls.mediaLoop && controls.mediaMinPlays
          ? helperText
          : undefined}
      />
      <NumberField
        label={t('driver.rightRail.mediaMaxPlays')}
        control={controls.mediaMaxPlays}
        min={0}
        tooltip={!controls.mediaInteractionLabel && !controls.mediaAutostart &&
            !controls.mediaLoop && !controls.mediaMinPlays &&
            controls.mediaMaxPlays
          ? helperText
          : undefined}
      />
      <TextField
        label={t('driver.rightRail.mediaCoords')}
        control={controls.mediaCoords}
        placeholder='x,y,width,height'
        tooltip={!controls.mediaInteractionLabel && !controls.mediaAutostart &&
            !controls.mediaLoop && !controls.mediaMinPlays &&
            !controls.mediaMaxPlays && controls.mediaCoords
          ? helperText
          : undefined}
      />
      <NumberField
        label={t('driver.rightRail.mediaWidth')}
        control={controls.mediaWidth}
        min={1}
        tooltip={!controls.mediaInteractionLabel && !controls.mediaAutostart &&
            !controls.mediaLoop && !controls.mediaMinPlays &&
            !controls.mediaMaxPlays && !controls.mediaCoords && controls.mediaWidth
          ? helperText
          : undefined}
      />
      <NumberField
        label={t('driver.rightRail.mediaHeight')}
        control={controls.mediaHeight}
        min={1}
        tooltip={!controls.mediaInteractionLabel && !controls.mediaAutostart &&
            !controls.mediaLoop && !controls.mediaMinPlays &&
            !controls.mediaMaxPlays && !controls.mediaCoords && !controls.mediaWidth &&
            controls.mediaHeight
          ? helperText
          : undefined}
      />
      <MediaPlayerControlsField
        label={t('driver.rightRail.mediaPlayerControls')}
        control={controls.mediaPlayerControls}
      />
      <NumberField
        label={t('driver.rightRail.mediaPauseDelay')}
        control={controls.mediaPauseDelay}
        min={0}
        placeholder={t('driver.rightRail.mediaSeconds')}
      />
      <NumberField
        label={t('driver.rightRail.mediaPauseDuration')}
        control={controls.mediaPauseDuration}
        min={0}
        placeholder={t('driver.rightRail.mediaSeconds')}
      />
    </div>
  );
};

export const SharedVocabularySection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  if (!hasSharedVocabularyControls(controls)) return null;
  return (
    <div class='space-y-2 rounded-lg border border-base-300/80 bg-base-100/70 p-2.5'>
      <div class='text-xs font-medium uppercase tracking-wide text-base-content/60'>
        {t('driver.rightRail.sharedVocabulary')}
      </div>
      <SelectField label={t('driver.rightRail.sharedLabels')} control={controls.sharedLabelStyle} />
      <SelectField
        label={t('driver.rightRail.sharedLabelSuffix')}
        control={controls.sharedLabelSuffix}
      />
      <SelectField
        label={t('driver.rightRail.sharedOrientation')}
        control={controls.sharedOrientation}
      />
      <SelectField
        label={t('driver.rightRail.sharedChoiceStacking')}
        control={controls.sharedChoicesStacking}
      />
      <SelectField
        label={t('driver.rightRail.sharedChoicesPlacement')}
        control={controls.sharedChoicesPosition}
      />
      <NumberField
        label={t('driver.rightRail.sharedChoicesContainerWidth')}
        control={controls.sharedChoicesContainerWidth}
        min={1}
        placeholder={t('driver.rightRail.sharedOptionalPx')}
      />
      <SelectField
        label={t('driver.rightRail.sharedSelectionTone')}
        control={controls.sharedSelectionTone}
      />
      <ToggleField
        label={t('driver.rightRail.sharedHideInputControl')}
        control={controls.sharedInputControlHidden}
      />
      <ToggleField
        label={t('driver.rightRail.sharedHideUnselectedChoices')}
        control={controls.sharedUnselectedHidden}
      />
      <SelectField
        label={t('driver.rightRail.sharedWritingOrientation')}
        control={controls.sharedWritingOrientation}
      />
      <ToggleField
        label={t('driver.rightRail.sharedTabularMatch')}
        control={controls.sharedMatchTabular}
      />
      <ToggleField
        label={t('driver.rightRail.sharedHideMatchHeader')}
        control={controls.sharedMatchHeaderHidden}
      />
      <TextField
        label={t('driver.rightRail.sharedFirstColumnHeader')}
        control={controls.sharedMatchFirstColumnHeader}
        placeholder={t('driver.rightRail.sharedOptionalHeader')}
      />
      <ToggleField
        label={t('driver.rightRail.sharedGapPlacement')}
        control={controls.sharedGapPlacement}
      />
    </div>
  );
};

export const PortableCustomSection: FunctionalComponent<SectionProps> = ({ controls }) => {
  const t = useI18n().t;
  const hasPortable = Boolean(
    controls.portableModule || controls.portableClassName || controls.portableLabel ||
      controls.portableBaseType || controls.portableCardinality ||
      controls.portableModulesPrimaryConfiguration ||
      controls.portableModulesSecondaryConfiguration || controls.portableInteractionModules,
  );
  if (!hasPortable) return null;

  const modules = controls.portableInteractionModules?.value ?? [];
  const updateModules = (next: PortableInteractionModule[]) =>
    controls.portableInteractionModules?.onChange(next);
  const addModule = () =>
    updateModules([...modules, { id: '', primaryPath: '', fallbackPath: '' }]);
  const updateModule = (index: number, patch: Partial<PortableInteractionModule>) => {
    updateModules(modules.map((mod, idx) => (idx === index ? { ...mod, ...patch } : mod)));
  };
  const removeModule = (index: number) => updateModules(modules.filter((_, idx) => idx !== index));

  return (
    <div class='space-y-2'>
      <div class='flex items-center gap-2 text-sm text-base-content/70'>
        <span class='font-medium text-base-content/80'>{t('driver.rightRail.portableCustom')}</span>
        <InfoTooltip text={t('driver.rightRail.portableCustomHelp')} />
      </div>
      <TextField
        label={t('driver.rightRail.portableResponseBaseType')}
        control={controls.portableBaseType}
        placeholder='string'
      />
      {controls.portableCardinality && (
        <label class='ds-form-control gap-1'>
          <span>{t('driver.rightRail.portableResponseCardinality')}</span>
          <Select
            value={controls.portableCardinality.value}
            onInput={(e) =>
              controls.portableCardinality?.onChange((e.target as HTMLSelectElement).value)}
          >
            <option value='single'>single</option>
            <option value='multiple'>multiple</option>
            <option value='ordered'>ordered</option>
            <option value='record'>record</option>
          </Select>
        </label>
      )}
      <TextField
        label={t('driver.rightRail.portableModuleName')}
        control={controls.portableModule}
        placeholder='pciModule'
      />
      <TextField
        label={t('driver.rightRail.portableClassName')}
        control={controls.portableClassName}
        placeholder='pci-class'
      />
      <TextField
        label={t('driver.rightRail.portableLabel')}
        control={controls.portableLabel}
        placeholder={t('driver.rightRail.portableLabelPlaceholder')}
      />
      <TextField
        label={t('driver.rightRail.portablePrimaryModuleConfig')}
        control={controls.portableModulesPrimaryConfiguration}
        placeholder='modules/module_resolution.js'
      />
      <TextField
        label={t('driver.rightRail.portableSecondaryModuleConfig')}
        control={controls.portableModulesSecondaryConfiguration}
        placeholder='modules/fallback_module_resolution.js'
      />
      {controls.portableInteractionModules && (
        <div class='space-y-1'>
          <div class='flex items-center justify-between'>
            <strong class='text-sm text-base-content/80'>
              {t('driver.rightRail.portableInteractionModules')}
            </strong>
            <Button size='sm' type='button' onClick={addModule}>
              {t('driver.rightRail.portableAddModule')}
            </Button>
          </div>
          {modules.length === 0 && (
            <p class='text-xs text-base-content/60'>{t('driver.rightRail.portableModulesEmpty')}</p>
          )}
          <div class='space-y-1'>
            {modules.map((mod, index) => (
              <div
                key={`pci-module-${index}`}
                class='grid gap-2 rounded-lg border border-base-300 bg-base-100 p-3'
              >
                <TextField
                  label={t('driver.rightRail.portableModuleId')}
                  control={{
                    value: mod.id ?? '',
                    onChange: (next) => updateModule(index, { id: next }),
                  }}
                  placeholder='moduleId'
                />
                <TextField
                  label={t('driver.rightRail.portablePrimaryPath')}
                  control={{
                    value: mod.primaryPath ?? '',
                    onChange: (next) => updateModule(index, { primaryPath: next }),
                  }}
                  placeholder='modules/example.js'
                />
                <TextField
                  label={t('driver.rightRail.portableFallbackPath')}
                  control={{
                    value: mod.fallbackPath ?? '',
                    onChange: (next) => updateModule(index, { fallbackPath: next }),
                  }}
                  placeholder='modules/example-fallback.js'
                />
                <div class='flex justify-end'>
                  <Button
                    size='xs'
                    variant='danger-ghost'
                    type='button'
                    onClick={() => removeModule(index)}
                  >
                    {t('driver.rightRail.portableRemoveModule')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
