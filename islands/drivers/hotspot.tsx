import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useEffect, useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Input, { FieldIssueMessage } from '../../components/ui/Input.tsx';
import ImageAssetEditor from '../../components/ui/ImageAssetEditor.tsx';
import Select from '../../components/ui/Select.tsx';
import Checkbox from '../../components/ui/Checkbox.tsx';
import Radio from '../../components/ui/Radio.tsx';
import type { DriverUiContext } from './view_registry.ts';
import { sanitizeIdentifier } from '../../lib/identifiers.ts';
import type { HotspotChoice } from '../../lib/types/hotspot.ts';
import type { ImageAsset } from '../../lib/types/image_asset.ts';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { commonContentProps, setDraftFieldValue, setDraftListFieldValue } from './editor_shell.tsx';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { HotspotCanvasEditor } from './hotspot_canvas_editor.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';

export type HotspotContentProps = CommonContentProps & {
  image: ImageAsset;
  responseIdentifier: string;
  maxChoices?: number;
  choices: HotspotChoice[];

  setImage: (image: ImageAsset) => void;
  setResponseIdentifier: (id: string) => void;
  setCorrectIds: (ids: string[]) => void;

  addHotspotChoice: () => void;
  removeHotspotChoice: (id: string) => void;
  updateHotspotChoiceId: (id: string, nextId: string) => void;
  updateHotspotChoiceShape: (id: string, shape: HotspotChoice['shape']) => void;
  updateHotspotChoiceCoords: (id: string, coords: string) => void;
  correctIds: string[];
};

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export function HotspotContent(props: HotspotContentProps) {
  const i18n = useI18n();
  const answersIssueId = useDomId();
  const single = props.maxChoices === 1;
  const [activeChoiceId, setActiveChoiceId] = useState<string>(() => props.choices[0]?.id ?? '');

  useEffect(() => {
    if (!props.choices.length) {
      if (activeChoiceId) setActiveChoiceId('');
      return;
    }
    if (!props.choices.some((c) => c.id === activeChoiceId)) {
      setActiveChoiceId(props.choices[0]?.id ?? '');
    }
  }, [props.choices, activeChoiceId]);

  return (
    <div class='space-y-4'>
      {props.renderPromptField(i18n.t('driver.hotspotPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.responseIdentifier}
        onChange={props.setResponseIdentifier}
      />

      <ImageAssetEditor
        labels={{
          source: i18n.t('driver.hotspotImageSource'),
          alt: i18n.t('driver.hotspotImageAlt'),
          altPlaceholder: i18n.t('driver.hotspotImageAltPlaceholder'),
          longDescription: i18n.t('driver.hotspotImageLongDescription'),
          mimeType: i18n.t('driver.hotspotImageMimeType'),
        }}
        value={props.image}
        fields={['longDescription', 'mimeType']}
        onChange={props.setImage}
      />

      <div class='space-y-2'>
        <div class='flex items-center justify-between'>
          <strong class='text-sm text-base-content/80'>{i18n.t('driver.hotspotRegions')}</strong>
          <Button
            size='sm'
            type='button'
            data-editor-field={props.choices.length === 0 ? 'choices' : undefined}
            aria-describedby={props.fieldHasIssue('choices') ? answersIssueId : undefined}
            onClick={props.addHotspotChoice}
          >
            + {i18n.t('driver.hotspotAddRegion')}
          </Button>
        </div>
        <p class='text-xs text-base-content/60'>
          {i18n.t('driver.hotspotHelp')}
        </p>
        {(props.fieldHasIssue('choices') || props.fieldHasIssue('correct')) && (
          <FieldIssueMessage
            id={answersIssueId}
            message={props.fieldIssueText('choices') ?? props.fieldIssueText('correct') ?? ''}
          />
        )}
        {props.choices.length === 0 && (
          <p class='text-sm text-base-content/60'>{i18n.t('driver.hotspotEmpty')}</p>
        )}
        <div class='space-y-2'>
          {props.choices.map((choice) => {
            const selected = props.correctIds.includes(choice.id);
            return (
              <div
                key={choice.id}
                class={`grid gap-2 rounded-lg border border-base-200 bg-base-100 px-3 py-2 md:grid-cols-[6rem_7rem_minmax(0,1fr)_10rem_auto] md:items-start ${
                  choice.id === activeChoiceId ? 'ring-1 ring-primary/40' : ''
                }`}
              >
                <label class='ds-form-control'>
                  <span class='text-xs'>{i18n.t('driver.identifier')}</span>
                  <Input
                    size='sm'
                    value={choice.id}
                    data-editor-field='choices'
                    aria-invalid={props.fieldHasIssue('choices') || undefined}
                    aria-describedby={props.fieldHasIssue('choices') ? answersIssueId : undefined}
                    onInput={(e) =>
                      props.updateHotspotChoiceId(choice.id, (e.target as HTMLInputElement).value)}
                    placeholder='A'
                  />
                </label>
                <label class='ds-form-control'>
                  <span class='text-xs'>{i18n.t('driver.shape')}</span>
                  <Select
                    size='sm'
                    value={choice.shape}
                    aria-invalid={props.fieldHasIssue('choices') || undefined}
                    aria-describedby={props.fieldHasIssue('choices') ? answersIssueId : undefined}
                    onInput={(e) =>
                      props.updateHotspotChoiceShape(
                        choice.id,
                        (e.target as HTMLSelectElement).value as HotspotChoice['shape'],
                      )}
                  >
                    <option value='circle'>{i18n.t('driver.circle')}</option>
                    <option value='rect'>{i18n.t('driver.rectangle')}</option>
                    <option value='poly'>{i18n.t('driver.polygon')}</option>
                  </Select>
                </label>
                <label class='ds-form-control'>
                  <span class='text-xs'>{i18n.t('driver.coordinates')}</span>
                  <Input
                    size='sm'
                    value={choice.coords}
                    placeholder={choice.shape === 'circle' ? 'x,y,r' : 'x1,y1,x2,y2'}
                    readOnly
                  />
                </label>
                <div class='space-y-1'>
                  <div class='text-xs font-medium text-base-content/70'>
                    {i18n.t('driver.correct')}
                  </div>
                  <label class='flex min-h-8 items-center gap-2 rounded-md border border-base-300 bg-base-200/30 px-2 py-1 text-xs text-base-content/70'>
                    {single
                      ? (
                        <Radio
                          name='hotspot-correct'
                          checked={selected}
                          data-editor-field='correct'
                          aria-invalid={props.fieldHasIssue('correct') || undefined}
                          aria-describedby={props.fieldHasIssue('correct')
                            ? answersIssueId
                            : undefined}
                          aria-label={`${i18n.t('driver.markCorrect')}: ${choice.id}`}
                          onChange={() => props.setCorrectIds(choice.id ? [choice.id] : [])}
                        />
                      )
                      : (
                        <Checkbox
                          checked={selected}
                          data-editor-field='correct'
                          aria-invalid={props.fieldHasIssue('correct') || undefined}
                          aria-describedby={props.fieldHasIssue('correct')
                            ? answersIssueId
                            : undefined}
                          aria-label={`${i18n.t('driver.markCorrect')}: ${choice.id}`}
                          onChange={() =>
                            props.setCorrectIds(toggleId(props.correctIds, choice.id))}
                        />
                      )}
                    <span>{i18n.t('driver.markCorrect')}</span>
                  </label>
                </div>
                <div class='flex items-center justify-end gap-2 md:pt-5'>
                  {choice.id === activeChoiceId
                    ? (
                      <span class='ds-badge ds-badge-sm border-primary/25 bg-base-200 text-base-content/75'>
                        {i18n.t('driver.editing')}
                      </span>
                    )
                    : (
                      <Button
                        size='xs'
                        type='button'
                        variant='ghost'
                        onClick={() => setActiveChoiceId(choice.id)}
                      >
                        {i18n.t('driver.edit')}
                      </Button>
                    )}
                  <Button
                    size='xs'
                    variant='danger-ghost'
                    type='button'
                    disabled={props.choices.length <= 1}
                    onClick={() => props.removeHotspotChoice(choice.id)}
                  >
                    {i18n.t('driver.remove')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div class='space-y-2'>
        <div class='flex flex-wrap items-center gap-2'>
          <strong class='text-sm text-base-content/80'>{i18n.t('driver.regionEditor')}</strong>
          {props.choices.length > 0 && (
            <label class='flex items-center gap-2'>
              <span class='text-xs text-base-content/60'>{i18n.t('driver.editingRegion')}</span>
              <span class='block w-20'>
                <Select
                  size='sm'
                  value={activeChoiceId}
                  onInput={(e) => setActiveChoiceId((e.target as HTMLSelectElement).value)}
                >
                  {props.choices.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
                </Select>
              </span>
            </label>
          )}
        </div>
        <HotspotCanvasEditor
          backgroundSrc={props.image.source}
          backgroundAlt={props.image.alt}
          hotspots={props.choices}
          activeHotspotId={activeChoiceId}
          updateHotspotCoords={props.updateHotspotChoiceCoords}
          emptyMessage={i18n.t('driver.hotspotCanvasEmpty')}
        />
        {!props.image.source && (
          <p class='text-xs text-base-content/60'>
            {i18n.t('driver.hotspotStarterHelp')}
          </p>
        )}
      </div>
    </div>
  );
}

function HotspotEditor(ctx: DriverUiContext<'hotspot'>) {
  const { editor, draft, update } = ctx;
  const choices = draft.choices;
  const correctIds = draft.correctIds ?? [];

  const setChoices = (
    value: HotspotChoice[] | ((prev: HotspotChoice[]) => HotspotChoice[]),
  ) => {
    setDraftListFieldValue(editor, draft, update, 'choices', value);
  };

  const setCorrectIds = (value: string[] | ((prev: string[]) => string[])) => {
    setDraftListFieldValue(editor, draft, update, 'correctIds', value);
  };

  const nextHotspotChoiceId = () => {
    const existing = new Set(choices.map((choice) => (choice.id ?? '').toUpperCase()));
    for (let i = 0; i < 26; i++) {
      const candidate = String.fromCharCode('A'.charCodeAt(0) + i);
      if (!existing.has(candidate)) return candidate;
    }
    let idx = existing.size + 1;
    let candidate = `HS_${idx}`;
    while (existing.has(candidate.toUpperCase())) {
      idx += 1;
      candidate = `HS_${idx}`;
    }
    return candidate;
  };

  return (
    <HotspotContent
      {...commonContentProps(editor)}
      image={{
        source: draft.hotspotImageSrc ?? '',
        alt: draft.hotspotImageAlt ?? '',
        longDescription: draft.hotspotImageLongDesc,
        mimeType: draft.hotspotImageType,
      }}
      responseIdentifier={draft.responseIdentifier ?? 'RESPONSE'}
      maxChoices={draft.maxChoices}
      choices={choices}
      correctIds={correctIds}
      setImage={(image) =>
        update({
          ...draft,
          hotspotImageSrc: image.source,
          hotspotImageAlt: image.alt,
          hotspotImageLongDesc: image.longDescription,
          hotspotImageType: image.mimeType,
        })}
      setResponseIdentifier={(value) =>
        setDraftFieldValue(editor, draft, update, 'responseIdentifier', value)}
      setCorrectIds={(ids) => setCorrectIds(ids)}
      addHotspotChoice={() => {
        const id = nextHotspotChoiceId();
        setChoices((prev) => [...prev, { id, shape: 'circle', coords: '50,50,20' }]);
      }}
      removeHotspotChoice={(id) => {
        setChoices((prev) => prev.filter((choice) => choice.id !== id));
        setCorrectIds((prev) => prev.filter((cid) => cid !== id));
      }}
      updateHotspotChoiceId={(id, nextInput) => {
        const sanitizedBase = sanitizeIdentifier(nextInput || id, id);
        let finalId = sanitizedBase;
        if (choices.some((choice) => choice.id === finalId && choice.id !== id)) {
          let suffix = 2;
          const base = sanitizedBase.replace(/_\d+$/, '');
          while (choices.some((choice) => choice.id === `${base}_${suffix}`)) suffix += 1;
          finalId = `${base}_${suffix}`;
        }
        update({
          ...draft,
          choices: choices.map((
            choice,
          ) => (choice.id === id ? { ...choice, id: finalId } : choice)),
          correctIds: correctIds.map((cid) => (cid === id ? finalId : cid)),
        });
      }}
      updateHotspotChoiceShape={(id, shape) =>
        setChoices((prev) =>
          prev.map((choice) => (choice.id === id ? { ...choice, shape } : choice))
        )}
      updateHotspotChoiceCoords={(id, coords) =>
        setChoices((prev) =>
          prev.map((choice) => (choice.id === id ? { ...choice, coords } : choice))
        )}
    />
  );
}

attachStandardDriverViews('hotspot', HotspotEditor);
