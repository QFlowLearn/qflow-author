import { useEffect } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import { setDraftFieldValue, setDraftListFieldValue } from './editor_shell.tsx';
import Button from '../../components/ui/Button.tsx';
import Input from '../../components/ui/Input.tsx';
import ImageAssetEditor from '../../components/ui/ImageAssetEditor.tsx';
import Select from '../../components/ui/Select.tsx';
import type { DriverUiContext } from './view_registry.ts';
import type { SelectPointShape, SelectPointTarget } from '../../lib/types/select_point.ts';
import { defaultsSelectPoint } from '../../lib/types/select_point.ts';
import type { ImageAsset } from '../../lib/types/image_asset.ts';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { attachStandardDriverViews } from './standard_driver_views.ts';
import { SelectPointCorrectPointsEditor } from './select_point_canvas_editor.tsx';

export type SelectPointContentProps = CommonContentProps & {
  responseIdentifier: string;
  image: ImageAsset;
  maxChoices?: number;
  targets: SelectPointTarget[];
  correctPoints: string[];

  setResponseIdentifier: (id: string) => void;
  setImage: (image: ImageAsset) => void;

  addTarget: () => void;
  removeTarget: (index: number) => void;
  updateTargetShape: (index: number, shape: SelectPointShape) => void;
  updateTargetCoords: (index: number, coords: string) => void;
  updateTargetMappedValue: (index: number, value?: number) => void;

  setCorrectPoints: (points: string[]) => void;
};

function SelectPointEditor(ctx: DriverUiContext<'select_point'>) {
  const { editor, draft, update } = ctx;
  const targets = draft.selectPointTargets ?? [];
  const correctPoints = draft.selectPointCorrectPoints ?? [];

  const setDraftField = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K] | ((prev: (typeof draft)[K]) => (typeof draft)[K]),
  ) => setDraftFieldValue(editor, draft, update, key, value);

  useEffect(() => {
    if (draft.selectPointImageSrc || targets.length) return;
    const defaults = defaultsSelectPoint();
    update({
      ...draft,
      responseIdentifier: draft.responseIdentifier ?? defaults.responseIdentifier ?? 'RESPONSE',
      selectPointImageSrc: defaults.selectPointImageSrc ?? '',
      selectPointImageAlt: defaults.selectPointImageAlt ?? '',
      selectPointImageLongDesc: defaults.selectPointImageLongDesc ?? '',
      selectPointImageType: defaults.selectPointImageType,
      selectPointImageWidth: defaults.selectPointImageWidth,
      selectPointImageHeight: defaults.selectPointImageHeight,
      selectPointTargets: defaults.selectPointTargets ?? [],
      selectPointCorrectPoints: defaults.selectPointCorrectPoints ?? [],
      minChoices: defaults.minChoices ?? undefined,
      maxChoices: defaults.maxChoices ?? undefined,
    });
  }, [draft.selectPointImageSrc, targets.length]);

  const setResponseIdentifier = (value: string) => setDraftField('responseIdentifier', value);
  const setImage = (image: ImageAsset) =>
    update({
      ...draft,
      selectPointImageSrc: image.source,
      selectPointImageAlt: image.alt,
      selectPointImageLongDesc: image.longDescription,
      selectPointImageType: image.mimeType,
      selectPointImageWidth: image.width,
      selectPointImageHeight: image.height,
    });

  const addTarget = () =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'selectPointTargets',
      (prev) => [
        ...prev,
        { shape: 'circle' as const, coords: '120,120,12', mappedValue: 1 },
      ],
    );
  const removeTarget = (index: number) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'selectPointTargets',
      (prev) => prev.filter((_, idx) => idx !== index),
    );
  const updateTargetShape = (index: number, shape: SelectPointShape) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'selectPointTargets',
      (prev) => prev.map((t, idx) => (idx === index ? { ...t, shape } : t)),
    );
  const updateTargetCoords = (index: number, coords: string) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'selectPointTargets',
      (prev) => prev.map((t, idx) => (idx === index ? { ...t, coords } : t)),
    );
  const updateTargetMappedValue = (index: number, value?: number) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'selectPointTargets',
      (prev) => prev.map((t, idx) => (idx === index ? { ...t, mappedValue: value } : t)),
    );

  const setCorrectPoints = (points: string[]) => setDraftField('selectPointCorrectPoints', points);

  return (
    <SelectPointContent
      renderPromptField={editor.renderPromptField ?? (() => null)}
      fieldHasIssue={editor.fieldHasIssue ?? (() => false)}
      fieldIssueText={editor.fieldIssueText ?? (() => undefined)}
      responseIdentifier={draft.responseIdentifier ?? 'RESPONSE'}
      image={{
        source: draft.selectPointImageSrc ?? '',
        alt: draft.selectPointImageAlt ?? '',
        longDescription: draft.selectPointImageLongDesc,
        mimeType: draft.selectPointImageType,
        width: draft.selectPointImageWidth,
        height: draft.selectPointImageHeight,
      }}
      maxChoices={draft.maxChoices}
      targets={targets}
      correctPoints={correctPoints}
      setResponseIdentifier={setResponseIdentifier}
      setImage={setImage}
      addTarget={addTarget}
      removeTarget={removeTarget}
      updateTargetShape={updateTargetShape}
      updateTargetCoords={updateTargetCoords}
      updateTargetMappedValue={updateTargetMappedValue}
      setCorrectPoints={setCorrectPoints}
    />
  );
}

export function SelectPointContent(props: SelectPointContentProps) {
  const i18n = useI18n();
  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.selectPointPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.responseIdentifier}
        onChange={props.setResponseIdentifier}
      />

      <ImageAssetEditor
        labels={{
          source: i18n.t('editor.imageSource'),
          alt: i18n.t('editor.imageAlt'),
          altPlaceholder: i18n.t('editor.imageAltPlaceholder'),
          longDescription: i18n.t('editor.imageLongDescription'),
          mimeType: i18n.t('editor.mimeTypeOptional'),
          width: i18n.t('editor.widthPixels'),
          height: i18n.t('editor.heightPixels'),
        }}
        value={props.image}
        fields={['longDescription', 'mimeType', 'width', 'height']}
        onChange={props.setImage}
      />

      <div class='space-y-2'>
        <div class='flex items-center justify-between'>
          <strong class='text-sm text-base-content/80'>
            {i18n.t('driver.selectPointTargets')}
          </strong>
          <Button size='sm' type='button' onClick={props.addTarget}>
            + {i18n.t('driver.selectPointAddTarget')}
          </Button>
        </div>
        {props.targets.length === 0 && (
          <p class='text-sm text-base-content/60'>{i18n.t('driver.selectPointEmptyTargets')}</p>
        )}
        <div class='space-y-2'>
          {props.targets.map((target, index) => (
            <div
              key={`select-point-target-${index}`}
              class='grid gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 md:grid-cols-[8rem_1fr_8rem_auto]'
            >
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.shape')}</span>
                <Select
                  size='sm'
                  value={target.shape}
                  onInput={(e) =>
                    props.updateTargetShape(
                      index,
                      (e.target as HTMLSelectElement).value as SelectPointShape,
                    )}
                >
                  <option value='circle'>{i18n.t('driver.circle')}</option>
                  <option value='rect'>{i18n.t('driver.rectangle')}</option>
                  <option value='poly'>{i18n.t('driver.polygon')}</option>
                  <option value='default'>{i18n.t('driver.selectPointDefaultShape')}</option>
                </Select>
              </label>
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.coordinates')}</span>
                <Input
                  size='sm'
                  value={target.coords}
                  onInput={(e) =>
                    props.updateTargetCoords(index, (e.target as HTMLInputElement).value)}
                  placeholder='x,y,r or x1,y1,x2,y2'
                />
              </label>
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.selectPointMappedValue')}</span>
                <Input
                  size='sm'
                  type='number'
                  min={0}
                  value={target.mappedValue ?? ''}
                  onInput={(e) => {
                    const raw = (e.target as HTMLInputElement).value;
                    props.updateTargetMappedValue(
                      index,
                      raw === '' ? undefined : Math.max(0, Number(raw) || 0),
                    );
                  }}
                  placeholder='1'
                />
              </label>
              <div class='flex items-end justify-end'>
                <Button
                  size='xs'
                  variant='danger-ghost'
                  type='button'
                  onClick={() => props.removeTarget(index)}
                >
                  {i18n.t('driver.remove')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <SelectPointCorrectPointsEditor
        imageSrc={props.image.source}
        imageAlt={props.image.alt}
        imageWidth={props.image.width}
        imageHeight={props.image.height}
        maxChoices={props.maxChoices}
        value={props.correctPoints}
        issue={props.fieldIssueText('correct')}
        onChange={props.setCorrectPoints}
      />
    </div>
  );
}

attachStandardDriverViews('select_point', SelectPointEditor);
