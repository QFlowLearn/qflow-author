import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useEffect } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import { setDraftFieldValue, setDraftListFieldValue } from './editor_shell.tsx';
import Button from '../../components/ui/Button.tsx';
import Input, { FieldIssueMessage } from '../../components/ui/Input.tsx';
import ImageAssetEditor from '../../components/ui/ImageAssetEditor.tsx';
import Select from '../../components/ui/Select.tsx';
import type { DriverUiContext } from './view_registry.ts';
import type { PositionObjectShape, PositionObjectTarget } from '../../lib/types/position_object.ts';
import { defaultsPositionObject } from '../../lib/types/position_object.ts';
import type { ImageAsset } from '../../lib/types/image_asset.ts';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { attachStandardDriverViews } from './standard_driver_views.ts';

export type PositionObjectContentProps = CommonContentProps & {
  responseIdentifier: string;
  stageImage: ImageAsset;
  objectImage: ImageAsset;
  centerPoint?: string;
  targets: PositionObjectTarget[];
  correctPoints: string[];

  setResponseIdentifier: (id: string) => void;
  setStageImage: (image: ImageAsset) => void;
  setObjectImage: (image: ImageAsset) => void;
  setCenterPoint: (value: string) => void;

  addTarget: () => void;
  removeTarget: (index: number) => void;
  updateTargetShape: (index: number, shape: PositionObjectShape) => void;
  updateTargetCoords: (index: number, coords: string) => void;
  updateTargetMappedValue: (index: number, value?: number) => void;

  addCorrectPoint: () => void;
  removeCorrectPoint: (index: number) => void;
  updateCorrectPoint: (index: number, value: string) => void;
};

function PositionObjectEditor(ctx: DriverUiContext<'position_object'>) {
  const { editor, draft, update } = ctx;
  const targets = draft.positionTargets ?? [];
  const correctPoints = draft.positionCorrectPoints ?? [];

  const setDraftField = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K] | ((prev: (typeof draft)[K]) => (typeof draft)[K]),
  ) => setDraftFieldValue(editor, draft, update, key, value);

  useEffect(() => {
    if (draft.positionStageSrc || draft.positionObjectSrc || targets.length) return;
    const defaults = defaultsPositionObject();
    update({
      ...draft,
      responseIdentifier: draft.responseIdentifier ?? defaults.responseIdentifier ?? 'RESPONSE',
      positionStageSrc: defaults.positionStageSrc ?? '',
      positionStageAlt: defaults.positionStageAlt ?? '',
      positionStageLongDesc: defaults.positionStageLongDesc ?? '',
      positionStageType: defaults.positionStageType ?? '',
      positionStageWidth: defaults.positionStageWidth,
      positionStageHeight: defaults.positionStageHeight,
      positionObjectSrc: defaults.positionObjectSrc ?? '',
      positionObjectAlt: defaults.positionObjectAlt ?? '',
      positionObjectType: defaults.positionObjectType ?? '',
      positionObjectWidth: defaults.positionObjectWidth,
      positionObjectHeight: defaults.positionObjectHeight,
      positionTargets: defaults.positionTargets ?? [],
      positionCorrectPoints: defaults.positionCorrectPoints ?? [],
      minChoices: defaults.minChoices ?? undefined,
      maxChoices: defaults.maxChoices ?? undefined,
    });
  }, [draft.positionStageSrc, draft.positionObjectSrc, targets.length]);

  const setResponseIdentifier = (value: string) => setDraftField('responseIdentifier', value);
  const setStageImage = (image: ImageAsset) =>
    update({
      ...draft,
      positionStageSrc: image.source,
      positionStageAlt: image.alt,
      positionStageLongDesc: image.longDescription,
      positionStageType: image.mimeType,
      positionStageWidth: image.width,
      positionStageHeight: image.height,
    });
  const setObjectImage = (image: ImageAsset) =>
    update({
      ...draft,
      positionObjectSrc: image.source,
      positionObjectAlt: image.alt,
      positionObjectType: image.mimeType,
      positionObjectWidth: image.width,
      positionObjectHeight: image.height,
    });
  const setCenterPoint = (value: string) => setDraftField('positionCenterPoint', value);

  const addTarget = () =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'positionTargets',
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
      'positionTargets',
      (prev) => prev.filter((_, idx) => idx !== index),
    );
  const updateTargetShape = (index: number, shape: PositionObjectShape) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'positionTargets',
      (prev) => prev.map((t, idx) => (idx === index ? { ...t, shape } : t)),
    );
  const updateTargetCoords = (index: number, coords: string) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'positionTargets',
      (prev) => prev.map((t, idx) => (idx === index ? { ...t, coords } : t)),
    );
  const updateTargetMappedValue = (index: number, value?: number) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'positionTargets',
      (prev) => prev.map((t, idx) => (idx === index ? { ...t, mappedValue: value } : t)),
    );

  const addCorrectPoint = () =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'positionCorrectPoints',
      (prev) => [...prev, ''],
    );
  const removeCorrectPoint = (index: number) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'positionCorrectPoints',
      (prev) => prev.filter((_, idx) => idx !== index),
    );
  const updateCorrectPoint = (index: number, value: string) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'positionCorrectPoints',
      (prev) => prev.map((p, idx) => (idx === index ? value : p)),
    );

  return (
    <PositionObjectContent
      renderPromptField={editor.renderPromptField ?? (() => null)}
      fieldHasIssue={editor.fieldHasIssue ?? (() => false)}
      fieldIssueText={editor.fieldIssueText ?? (() => undefined)}
      responseIdentifier={draft.responseIdentifier ?? 'RESPONSE'}
      stageImage={{
        source: draft.positionStageSrc ?? '',
        alt: draft.positionStageAlt ?? '',
        longDescription: draft.positionStageLongDesc,
        mimeType: draft.positionStageType,
        width: draft.positionStageWidth,
        height: draft.positionStageHeight,
      }}
      objectImage={{
        source: draft.positionObjectSrc ?? '',
        alt: draft.positionObjectAlt ?? '',
        mimeType: draft.positionObjectType,
        width: draft.positionObjectWidth,
        height: draft.positionObjectHeight,
      }}
      centerPoint={draft.positionCenterPoint ?? ''}
      targets={targets}
      correctPoints={correctPoints}
      setResponseIdentifier={setResponseIdentifier}
      setStageImage={setStageImage}
      setObjectImage={setObjectImage}
      setCenterPoint={setCenterPoint}
      addTarget={addTarget}
      removeTarget={removeTarget}
      updateTargetShape={updateTargetShape}
      updateTargetCoords={updateTargetCoords}
      updateTargetMappedValue={updateTargetMappedValue}
      addCorrectPoint={addCorrectPoint}
      removeCorrectPoint={removeCorrectPoint}
      updateCorrectPoint={updateCorrectPoint}
    />
  );
}

export function PositionObjectContent(props: PositionObjectContentProps) {
  const i18n = useI18n();
  const correctIssueId = useDomId();
  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.positionObjectPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.responseIdentifier}
        onChange={props.setResponseIdentifier}
      />

      <fieldset class='space-y-2'>
        <legend class='text-sm font-semibold text-base-content/80'>
          {i18n.t('driver.positionObjectStageImage')}
        </legend>
        <ImageAssetEditor
          labels={{
            source: i18n.t('driver.positionObjectStageSource'),
            alt: i18n.t('driver.positionObjectStageAlt'),
            altPlaceholder: i18n.t('driver.positionObjectStageAltPlaceholder'),
            longDescription: i18n.t('driver.positionObjectStageLongDescription'),
            mimeType: i18n.t('driver.positionObjectStageMimeType'),
            width: i18n.t('driver.positionObjectStageWidth'),
            height: i18n.t('driver.positionObjectStageHeight'),
          }}
          value={props.stageImage}
          fields={['longDescription', 'mimeType', 'width', 'height']}
          onChange={props.setStageImage}
        />
      </fieldset>

      <fieldset class='space-y-2'>
        <legend class='text-sm font-semibold text-base-content/80'>
          {i18n.t('driver.positionObjectObjectImage')}
        </legend>
        <ImageAssetEditor
          labels={{
            source: i18n.t('driver.positionObjectObjectSource'),
            alt: i18n.t('driver.positionObjectObjectAlt'),
            altPlaceholder: i18n.t('driver.positionObjectObjectAltPlaceholder'),
            mimeType: i18n.t('driver.positionObjectObjectMimeType'),
            width: i18n.t('driver.positionObjectObjectWidth'),
            height: i18n.t('driver.positionObjectObjectHeight'),
          }}
          value={props.objectImage}
          fields={['mimeType', 'width', 'height']}
          onChange={props.setObjectImage}
          metadataFooter={
            <label class='ds-form-control sm:col-span-2'>
              <span class='text-xs'>{i18n.t('driver.positionObjectCenterPoint')}</span>
              <Input
                size='sm'
                value={props.centerPoint ?? ''}
                onInput={(e) => props.setCenterPoint((e.target as HTMLInputElement).value)}
                placeholder='x y'
              />
            </label>
          }
        />
      </fieldset>

      <div class='space-y-2'>
        <div class='flex items-center justify-between'>
          <strong class='text-sm text-base-content/80'>
            {i18n.t('driver.positionObjectTargets')}
          </strong>
          <Button size='sm' type='button' onClick={props.addTarget}>
            + {i18n.t('driver.positionObjectAddTarget')}
          </Button>
        </div>
        {props.targets.length === 0 && (
          <p class='text-sm text-base-content/60'>{i18n.t('driver.positionObjectEmptyTargets')}</p>
        )}
        <div class='space-y-2'>
          {props.targets.map((target, index) => (
            <div
              key={`pos-target-${index}`}
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
                      (e.target as HTMLSelectElement).value as PositionObjectShape,
                    )}
                >
                  <option value='circle'>{i18n.t('driver.circle')}</option>
                  <option value='rect'>{i18n.t('driver.rectangle')}</option>
                  <option value='poly'>{i18n.t('driver.polygon')}</option>
                  <option value='default'>{i18n.t('driver.positionObjectDefaultShape')}</option>
                </Select>
              </label>
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.positionObjectCoords')}</span>
                <Input
                  size='sm'
                  value={target.coords}
                  onInput={(e) =>
                    props.updateTargetCoords(index, (e.target as HTMLInputElement).value)}
                  placeholder='x,y,r or x1,y1,x2,y2'
                />
              </label>
              <label class='ds-form-control'>
                <span class='text-xs'>{i18n.t('driver.positionObjectMappedValue')}</span>
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

      <div class='space-y-2'>
        <div class='flex items-center justify-between'>
          <strong class='text-sm text-base-content/80'>
            {i18n.t('driver.positionObjectCorrectPoints')}
          </strong>
          <Button
            size='sm'
            type='button'
            data-editor-field={props.correctPoints.length === 0 ? 'correct' : undefined}
            aria-describedby={props.fieldHasIssue('correct') ? correctIssueId : undefined}
            onClick={props.addCorrectPoint}
          >
            + {i18n.t('driver.positionObjectAddCorrectPoint')}
          </Button>
        </div>
        {props.fieldHasIssue('correct') && (
          <FieldIssueMessage id={correctIssueId} message={props.fieldIssueText('correct') ?? ''} />
        )}
        {props.correctPoints.length === 0 && (
          <p class='text-sm text-base-content/60'>
            {i18n.t('driver.positionObjectEmptyCorrectPoints')}
          </p>
        )}
        <div class='space-y-2'>
          {props.correctPoints.map((point, index) => (
            <div key={`pos-point-${index}`} class='flex items-center gap-2'>
              <Input
                size='sm'
                value={point}
                data-editor-field='correct'
                aria-label={i18n.t('driver.selectPointIndexed', { number: index + 1 })}
                aria-invalid={props.fieldHasIssue('correct') || undefined}
                aria-describedby={props.fieldHasIssue('correct') ? correctIssueId : undefined}
                onInput={(e) =>
                  props.updateCorrectPoint(index, (e.target as HTMLInputElement).value)}
                placeholder='x y'
              />
              <Button
                size='xs'
                variant='danger-ghost'
                type='button'
                onClick={() =>
                  props.removeCorrectPoint(index)}
              >
                {i18n.t('driver.positionObjectRemovePoint', { number: index + 1 })}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

attachStandardDriverViews('position_object', PositionObjectEditor);
