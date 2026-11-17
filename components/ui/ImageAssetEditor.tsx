import ImageUpload, { type ImageUploadMetadata } from './ImageUpload.tsx';
import Input from './Input.tsx';
import Textarea from './Textarea.tsx';
import type { ComponentChildren } from 'preact';
import type { ImageAsset, ImageAssetField } from '../../lib/types/image_asset.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import { useRef } from 'preact/hooks';

/** Author-facing labels for one image asset editor instance. */
export type ImageAssetEditorLabels = {
  source: string;
  alt: string;
  altPlaceholder: string;
  longDescription?: string;
  mimeType?: string;
  width?: string;
  height?: string;
};

type Props = {
  labels: ImageAssetEditorLabels;
  value: ImageAsset;
  fields: readonly ImageAssetField[];
  onChange: (value: ImageAsset) => void;
  variant?: 'default' | 'compact';
  minimumDimension?: 0 | 1;
  metadataFooter?: ComponentChildren;
};

/** Consistent source, accessibility, and metadata controls for authored images. */
export default function ImageAssetEditor(props: Props) {
  const i18n = useI18n();
  const valueRef = useRef(props.value);
  valueRef.current = props.value;
  const minimumDimension = props.minimumDimension ?? 1;
  const compact = props.variant === 'compact';
  const hasField = (field: ImageAssetField) => props.fields.includes(field);
  const update = (patch: Partial<ImageAsset>) => {
    const nextValue = { ...valueRef.current, ...patch };
    valueRef.current = nextValue;
    props.onChange(nextValue);
  };

  const applyMetadata = (metadata: ImageUploadMetadata) => {
    update({
      ...(hasField('mimeType') ? { mimeType: metadata.mimeType ?? '' } : {}),
      ...(hasField('width') ? { width: metadata.width } : {}),
      ...(hasField('height') ? { height: metadata.height } : {}),
    });
  };

  return (
    <div
      class={compact
        ? 'space-y-2'
        : 'grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)] lg:items-start'}
    >
      <ImageUpload
        compact={compact}
        label={props.labels.source}
        value={props.value.source}
        alt={props.value.alt}
        onChange={(source) => update({ source })}
        onMetadata={applyMetadata}
      />
      <div class='space-y-3'>
        <label class='flex flex-col'>
          <span>{props.labels.alt}</span>
          <Input
            size='sm'
            value={props.value.alt}
            onInput={(event) => update({ alt: event.currentTarget.value })}
            placeholder={props.labels.altPlaceholder}
          />
        </label>

        {hasField('longDescription') && (
          <label class='flex flex-col'>
            <span>{props.labels.longDescription ?? i18n.t('editor.imageLongDescription')}</span>
            <Textarea
              rows={4}
              value={props.value.longDescription ?? ''}
              onInput={(event) => update({ longDescription: event.currentTarget.value })}
              placeholder={i18n.t('editor.imageLongDescriptionPlaceholder')}
            />
          </label>
        )}

        {(hasField('mimeType') || hasField('width') || hasField('height') ||
          props.metadataFooter) && (
          <div class='grid gap-2 sm:grid-cols-2'>
            {hasField('mimeType') && (
              <label class='flex flex-col sm:col-span-2'>
                <span class='text-xs'>
                  {props.labels.mimeType ?? i18n.t('editor.mimeTypeOptional')}
                </span>
                <Input
                  size='sm'
                  value={props.value.mimeType ?? ''}
                  onInput={(event) => update({ mimeType: event.currentTarget.value })}
                  placeholder='image/png'
                />
              </label>
            )}
            {hasField('width') && (
              <DimensionInput
                label={props.labels.width ?? i18n.t('editor.widthPixels')}
                value={props.value.width}
                minimum={minimumDimension}
                optionalLabel={i18n.t('editor.optional')}
                onChange={(width) => update({ width })}
              />
            )}
            {hasField('height') && (
              <DimensionInput
                label={props.labels.height ?? i18n.t('editor.heightPixels')}
                value={props.value.height}
                minimum={minimumDimension}
                optionalLabel={i18n.t('editor.optional')}
                onChange={(height) => update({ height })}
              />
            )}
            {props.metadataFooter && <div class='sm:col-span-2'>{props.metadataFooter}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function DimensionInput(props: {
  label: string;
  value?: number;
  minimum: 0 | 1;
  optionalLabel: string;
  onChange: (value?: number) => void;
}) {
  return (
    <label class='flex flex-col'>
      <span class='text-xs'>{props.label}</span>
      <Input
        size='sm'
        type='number'
        min={props.minimum}
        value={props.value ?? ''}
        onInput={(event) => {
          const raw = event.currentTarget.value;
          props.onChange(
            raw === '' ? undefined : Math.max(props.minimum, Number(raw) || props.minimum),
          );
        }}
        placeholder={props.optionalLabel}
      />
    </label>
  );
}
