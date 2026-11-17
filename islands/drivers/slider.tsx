import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useEffect } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import { setDraftFieldValue, setDraftListFieldValue } from './editor_shell.tsx';
import Button from '../../components/ui/Button.tsx';
import { AuthoringSectionHeader } from '../../components/ui/AuthoringLayout.tsx';
import Input, { FieldIssueMessage } from '../../components/ui/Input.tsx';
import Select from '../../components/ui/Select.tsx';
import type { DriverUiContext } from './view_registry.ts';
import type { SliderMappingEntry, SliderOrientation } from '../../lib/types/slider.ts';
import { defaultsSlider } from '../../lib/types/slider.ts';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { attachStandardDriverViews } from './standard_driver_views.ts';

export type SliderContentProps = CommonContentProps & {
  responseIdentifier: string;
  lowerBound?: number;
  upperBound?: number;
  step?: number;
  orientation?: SliderOrientation;
  correctValue?: number;
  mappings: SliderMappingEntry[];

  setResponseIdentifier: (id: string) => void;
  setLowerBound: (value?: number) => void;
  setUpperBound: (value?: number) => void;
  setStep: (value?: number) => void;
  setOrientation: (value: SliderOrientation) => void;
  setCorrectValue: (value?: number) => void;

  addMapping: () => void;
  removeMapping: (index: number) => void;
  updateMappingKey: (index: number, value?: number) => void;
  updateMappingValue: (index: number, value?: number) => void;
};

function SliderEditor(ctx: DriverUiContext<'slider'>) {
  const { editor, draft, update } = ctx;
  const mappings = draft.sliderMappings ?? [];

  const setDraftField = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K] | ((prev: (typeof draft)[K]) => (typeof draft)[K]),
  ) => setDraftFieldValue(editor, draft, update, key, value);

  useEffect(() => {
    if (draft.sliderLowerBound != null || draft.sliderUpperBound != null || mappings.length) return;
    const defaults = defaultsSlider();
    update({
      ...draft,
      responseIdentifier: draft.responseIdentifier ?? defaults.responseIdentifier ?? 'RESPONSE',
      sliderLowerBound: defaults.sliderLowerBound,
      sliderUpperBound: defaults.sliderUpperBound,
      sliderStep: defaults.sliderStep,
      sliderStepLabel: defaults.sliderStepLabel,
      sliderOrientation: defaults.sliderOrientation,
      sliderReverse: defaults.sliderReverse,
      sliderCorrectValue: defaults.sliderCorrectValue,
      sliderMappings: defaults.sliderMappings ?? [],
    });
  }, [draft.sliderLowerBound, draft.sliderUpperBound, mappings.length]);

  const setResponseIdentifier = (value: string) => setDraftField('responseIdentifier', value);
  const setLowerBound = (value?: number) => setDraftField('sliderLowerBound', value);
  const setUpperBound = (value?: number) => setDraftField('sliderUpperBound', value);
  const setStep = (value?: number) => setDraftField('sliderStep', value);
  const setOrientation = (value: SliderOrientation) => setDraftField('sliderOrientation', value);
  const setCorrectValue = (value?: number) => setDraftField('sliderCorrectValue', value);

  const addMapping = () =>
    setDraftListFieldValue(editor, draft, update, 'sliderMappings', (prev) => [
      ...prev,
      { mapKey: draft.sliderCorrectValue ?? 0, mappedValue: 1 },
    ]);
  const removeMapping = (index: number) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'sliderMappings',
      (prev) => prev.filter((_, idx) => idx !== index),
    );
  const updateMappingKey = (index: number, value?: number) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'sliderMappings',
      (prev) =>
        prev.map((entry, idx) => (idx === index ? { ...entry, mapKey: value ?? 0 } : entry)),
    );
  const updateMappingValue = (index: number, value?: number) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'sliderMappings',
      (prev) =>
        prev.map((entry, idx) => (idx === index ? { ...entry, mappedValue: value ?? 0 } : entry)),
    );

  return (
    <SliderContent
      renderPromptField={editor.renderPromptField ?? (() => null)}
      fieldHasIssue={editor.fieldHasIssue ?? (() => false)}
      fieldIssueText={editor.fieldIssueText ?? (() => undefined)}
      responseIdentifier={draft.responseIdentifier ?? 'RESPONSE'}
      lowerBound={draft.sliderLowerBound ?? undefined}
      upperBound={draft.sliderUpperBound ?? undefined}
      step={draft.sliderStep ?? undefined}
      orientation={draft.sliderOrientation ?? 'horizontal'}
      correctValue={draft.sliderCorrectValue ?? undefined}
      mappings={mappings}
      setResponseIdentifier={setResponseIdentifier}
      setLowerBound={setLowerBound}
      setUpperBound={setUpperBound}
      setStep={setStep}
      setOrientation={setOrientation}
      setCorrectValue={setCorrectValue}
      addMapping={addMapping}
      removeMapping={removeMapping}
      updateMappingKey={updateMappingKey}
      updateMappingValue={updateMappingValue}
    />
  );
}

export function SliderContent(props: SliderContentProps) {
  const i18n = useI18n();
  const correctIssueId = useDomId();
  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.sliderPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.responseIdentifier}
        onChange={props.setResponseIdentifier}
      />

      <div class='grid gap-3 sm:grid-cols-2'>
        <label class='flex flex-col'>
          <span>{i18n.t('driver.sliderLowerBound')}</span>
          <Input
            type='number'
            value={props.lowerBound ?? ''}
            onInput={(e) => {
              const raw = (e.target as HTMLInputElement).value;
              props.setLowerBound(raw === '' ? undefined : Number(raw));
            }}
            placeholder='0'
          />
        </label>
        <label class='flex flex-col'>
          <span>{i18n.t('driver.sliderUpperBound')}</span>
          <Input
            type='number'
            value={props.upperBound ?? ''}
            onInput={(e) => {
              const raw = (e.target as HTMLInputElement).value;
              props.setUpperBound(raw === '' ? undefined : Number(raw));
            }}
            placeholder='100'
          />
        </label>
        <label class='flex flex-col'>
          <span>{i18n.t('driver.sliderStep')}</span>
          <Input
            type='number'
            min={0}
            value={props.step ?? ''}
            onInput={(e) => {
              const raw = (e.target as HTMLInputElement).value;
              props.setStep(raw === '' ? undefined : Number(raw));
            }}
            placeholder='1'
          />
        </label>
        <label class='flex flex-col'>
          <span>{i18n.t('driver.sliderOrientation')}</span>
          <Select
            value={props.orientation ?? 'horizontal'}
            onInput={(e) =>
              props.setOrientation((e.target as HTMLSelectElement).value as SliderOrientation)}
          >
            <option value='horizontal'>{i18n.t('driver.sliderHorizontal')}</option>
            <option value='vertical'>{i18n.t('driver.sliderVertical')}</option>
          </Select>
        </label>
      </div>

      <label class='flex flex-col'>
        <span>{i18n.t('driver.sliderCorrectValue')}</span>
        <Input
          type='number'
          value={props.correctValue ?? ''}
          data-editor-field='correct'
          aria-invalid={props.fieldHasIssue('correct') || undefined}
          aria-describedby={props.fieldHasIssue('correct') ? correctIssueId : undefined}
          onInput={(e) => {
            const raw = (e.target as HTMLInputElement).value;
            props.setCorrectValue(raw === '' ? undefined : Number(raw));
          }}
          placeholder='50'
        />
        {props.fieldHasIssue('correct') && (
          <FieldIssueMessage id={correctIssueId} message={props.fieldIssueText('correct') ?? ''} />
        )}
      </label>

      <div class='space-y-2'>
        <AuthoringSectionHeader
          heading={
            <strong class='text-sm text-base-content/80'>{i18n.t('driver.sliderMappings')}</strong>
          }
        >
          <Button size='sm' type='button' onClick={props.addMapping}>
            + {i18n.t('driver.sliderAddMapping')}
          </Button>
        </AuthoringSectionHeader>
        {props.mappings.length === 0 && (
          <p class='text-sm text-base-content/60'>{i18n.t('driver.sliderEmptyMappings')}</p>
        )}
        <div class='space-y-2'>
          {props.mappings.map((entry, index) => (
            <div
              key={`slider-map-${index}`}
              class='grid gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 md:grid-cols-[1fr_1fr_auto]'
            >
              <label class='flex flex-col'>
                <span class='text-xs'>{i18n.t('driver.sliderMapKey')}</span>
                <Input
                  size='sm'
                  type='number'
                  value={Number.isFinite(entry.mapKey) ? entry.mapKey : ''}
                  onInput={(e) => {
                    const raw = (e.target as HTMLInputElement).value;
                    props.updateMappingKey(index, raw === '' ? undefined : Number(raw));
                  }}
                  placeholder={i18n.t('driver.sliderMapKeyPlaceholder')}
                />
              </label>
              <label class='flex flex-col'>
                <span class='text-xs'>{i18n.t('driver.sliderMappedValue')}</span>
                <Input
                  size='sm'
                  type='number'
                  value={Number.isFinite(entry.mappedValue) ? entry.mappedValue : ''}
                  onInput={(e) => {
                    const raw = (e.target as HTMLInputElement).value;
                    props.updateMappingValue(index, raw === '' ? undefined : Number(raw));
                  }}
                  placeholder={i18n.t('driver.sliderMappedValuePlaceholder')}
                />
              </label>
              <div class='flex items-end justify-end'>
                <Button
                  size='xs'
                  variant='danger-ghost'
                  type='button'
                  aria-label={i18n.t('driver.sliderRemoveMapping', { number: index + 1 })}
                  onClick={() => props.removeMapping(index)}
                >
                  {i18n.t('driver.remove')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

attachStandardDriverViews('slider', SliderEditor);
