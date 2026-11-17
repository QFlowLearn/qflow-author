import type { JSX } from 'preact';
import { useI18n } from '../../lib/i18n/context.tsx';

import {
  cropZoom,
  type ImageEditState,
  MAX_IMAGE_OUTPUT_DIMENSION,
  parseCropAspect,
  rotateQuarterTurn,
  setCropAspect,
  setCropZoom,
  setOutputDimension,
  setOutputLocked,
} from '../../lib/client/image_edit.ts';
import Button from './Button.tsx';
import Checkbox from './Checkbox.tsx';
import Input from './Input.tsx';
import Range from './Range.tsx';
import Select from './Select.tsx';

type Props = {
  readonly state: ImageEditState;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly disabled?: boolean;
  readonly onPreview: (state: ImageEditState) => void;
  readonly onCommit: (state: ImageEditState, announcement?: string) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onReset: () => void;
};

/** Render native controls for crop, transform, sizing, and history actions. */
export default function ImageEditControls(props: Props) {
  const i18n = useI18n();
  const commitTransform = (
    transform: ImageEditState['transform'],
    announcement: string,
  ) => props.onCommit({ ...props.state, transform }, announcement);

  const previewRange = (
    transform: ImageEditState['transform'],
  ) => props.onPreview({ ...props.state, transform });

  return (
    <div class='space-y-4'>
      <div class='flex flex-wrap gap-2' role='group' aria-label={i18n.t('editor.imageEditHistory')}>
        <Button
          size='xs'
          type='button'
          disabled={props.disabled || !props.canUndo}
          onClick={props.onUndo}
        >
          {i18n.t('editor.undo')}
        </Button>
        <Button
          size='xs'
          type='button'
          disabled={props.disabled || !props.canRedo}
          onClick={props.onRedo}
        >
          {i18n.t('editor.redo')}
        </Button>
        <Button
          size='xs'
          type='button'
          variant='ghost'
          disabled={props.disabled}
          onClick={props.onReset}
        >
          {i18n.t('editor.resetImage')}
        </Button>
      </div>

      <div class='grid gap-3 md:grid-cols-2'>
        <label class='flex flex-col'>
          <span class='text-sm'>{i18n.t('editor.cropRatio')}</span>
          <Select
            size='sm'
            value={props.state.aspect}
            disabled={props.disabled}
            onInput={(event) => {
              const aspect = parseCropAspect(event.currentTarget.value);
              props.onCommit(
                setCropAspect(props.state, aspect),
                i18n.t('editor.cropRatioChanged', {
                  ratio: event.currentTarget.selectedOptions[0]?.text ?? aspect,
                }),
              );
            }}
          >
            <option value='free'>{i18n.t('editor.ratioFree')}</option>
            <option value='original'>{i18n.t('editor.ratioOriginal')}</option>
            <option value='square'>{i18n.t('editor.ratioSquare')}</option>
            <option value='four-three'>{i18n.t('editor.ratioStandard')}</option>
            <option value='sixteen-nine'>{i18n.t('editor.ratioWidescreen')}</option>
          </Select>
        </label>
        <label class='flex flex-col'>
          <span class='flex items-center justify-between gap-2 text-sm'>
            {i18n.t('editor.zoom')}
            <output>{i18n.formatPercent(cropZoom(props.state))}</output>
          </span>
          <Range
            min='1'
            max='4'
            step='0.1'
            value={cropZoom(props.state)}
            disabled={props.disabled}
            onInput={(event) =>
              props.onPreview(
                setCropZoom(props.state, Number(event.currentTarget.value)),
              )}
            onChange={(event) =>
              props.onCommit(
                setCropZoom(props.state, Number(event.currentTarget.value)),
                i18n.t('editor.imageZoomSet', {
                  zoom: Number(event.currentTarget.value),
                }),
              )}
          />
        </label>
      </div>

      <fieldset class='space-y-2'>
        <legend class='text-sm font-medium'>{i18n.t('editor.transform')}</legend>
        <div class='flex flex-wrap gap-2'>
          <Button
            size='xs'
            type='button'
            disabled={props.disabled}
            onClick={() =>
              props.onCommit(rotateQuarterTurn(props.state, 'left'), i18n.t('editor.rotatedLeft'))}
          >
            {i18n.t('editor.rotateLeft')}
          </Button>
          <Button
            size='xs'
            type='button'
            disabled={props.disabled}
            onClick={() =>
              props.onCommit(
                rotateQuarterTurn(props.state, 'right'),
                i18n.t('editor.rotatedRight'),
              )}
          >
            {i18n.t('editor.rotateRight')}
          </Button>
          <Button
            size='xs'
            type='button'
            aria-pressed={props.state.transform.flipHorizontal}
            disabled={props.disabled}
            onClick={() =>
              commitTransform(
                {
                  ...props.state.transform,
                  flipHorizontal: !props.state.transform.flipHorizontal,
                },
                i18n.t('editor.horizontalFlipChanged'),
              )}
          >
            {i18n.t('editor.flipHorizontal')}
          </Button>
          <Button
            size='xs'
            type='button'
            aria-pressed={props.state.transform.flipVertical}
            disabled={props.disabled}
            onClick={() =>
              commitTransform(
                {
                  ...props.state.transform,
                  flipVertical: !props.state.transform.flipVertical,
                },
                i18n.t('editor.verticalFlipChanged'),
              )}
          >
            {i18n.t('editor.flipVertical')}
          </Button>
        </div>
        <label class='flex flex-col'>
          <span class='flex items-center justify-between gap-2 text-sm'>
            {i18n.t('editor.straighten')}
            <output>
              {i18n.formatNumber(props.state.transform.straighten, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}°
            </output>
          </span>
          <Range
            min='-10'
            max='10'
            step='0.5'
            value={props.state.transform.straighten}
            disabled={props.disabled}
            onInput={(event) =>
              previewRange({
                ...props.state.transform,
                straighten: Number(event.currentTarget.value),
              })}
            onChange={(event) =>
              commitTransform(
                {
                  ...props.state.transform,
                  straighten: Number(event.currentTarget.value),
                },
                i18n.t('editor.imageStraightened', {
                  degrees: Number(event.currentTarget.value),
                }),
              )}
          />
        </label>
      </fieldset>

      <fieldset class='space-y-2'>
        <legend class='text-sm font-medium'>{i18n.t('editor.outputSize')}</legend>
        <div class='grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end'>
          <OutputDimension
            label={i18n.t('editor.width')}
            dimension='width'
            state={props.state}
            disabled={props.disabled}
            onCommit={props.onCommit}
          />
          <OutputDimension
            label={i18n.t('editor.height')}
            dimension='height'
            state={props.state}
            disabled={props.disabled}
            onCommit={props.onCommit}
          />
          <label class='flex min-h-10 items-center gap-2 text-sm'>
            <Checkbox
              size='sm'
              checked={props.state.output.locked}
              disabled={props.disabled}
              onChange={(event) =>
                props.onCommit(
                  setOutputLocked(props.state, event.currentTarget.checked),
                  event.currentTarget.checked
                    ? i18n.t('editor.outputRatioLocked')
                    : i18n.t('editor.outputRatioUnlocked'),
                )}
            />
            {i18n.t('editor.lockRatio')}
          </label>
        </div>
        <p class='text-xs text-base-content/70'>
          {i18n.t('editor.outputHelp', { max: MAX_IMAGE_OUTPUT_DIMENSION })}
        </p>
      </fieldset>
    </div>
  );
}

function OutputDimension(
  props: {
    readonly label: string;
    readonly dimension: 'width' | 'height';
    readonly state: ImageEditState;
    readonly disabled?: boolean;
    readonly onCommit: (state: ImageEditState, announcement?: string) => void;
  },
) {
  const i18n = useI18n();
  const value = props.state.output[props.dimension];
  const commit = (event: JSX.TargetedEvent<HTMLInputElement>) => {
    const next = setOutputDimension(
      props.state,
      props.dimension,
      Number(event.currentTarget.value),
    );
    props.onCommit(
      next,
      i18n.t('editor.outputDimensionSet', {
        dimension: props.label,
        value: next.output[props.dimension],
      }),
    );
  };
  return (
    <label class='flex flex-col'>
      <span class='text-sm'>{props.label} (px)</span>
      <Input
        size='sm'
        type='number'
        min='1'
        max={MAX_IMAGE_OUTPUT_DIMENSION}
        step='1'
        value={value}
        disabled={props.disabled}
        onChange={commit}
      />
    </label>
  );
}
