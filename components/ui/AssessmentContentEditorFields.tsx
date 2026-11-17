import { useDomId } from '../../lib/rendering/island_context.tsx';
import { useRef } from 'preact/hooks';
import type { AssessmentStandaloneContent } from '../../lib/assessment_standalone_content.ts';
import { type UploadedFile, uploadFile } from '../../lib/client/upload_file.ts';
import { UPLOAD_POLICIES, validateUploadHintStructured } from '../../lib/upload_policy.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import AssetUpload, { type AssetSelectionResult } from './AssetUpload.tsx';
import Input from './Input.tsx';
import Textarea from './Textarea.tsx';

/** Required content and accessibility fields stay beside the image or video they describe. */
export default function AssessmentContentEditorFields(props: {
  readonly content: AssessmentStandaloneContent;
  readonly error: string | null;
  readonly errorId: string;
  readonly invalid: boolean;
  readonly frozen: boolean;
  readonly busy: boolean;
  readonly onChange: (content: AssessmentStandaloneContent) => void;
  readonly onUploadBusy: (busy: boolean) => void;
}) {
  const i18n = useI18n(), id = useDomId();
  const current = useRef(props.content);
  current.current = props.content;
  function change(content: AssessmentStandaloneContent) {
    current.current = content;
    props.onChange(content);
  }
  function applyUpload(kind: 'image' | 'video' | 'captions', upload: UploadedFile) {
    const content = current.current;
    if (kind === 'image' && content.kind === 'image') change({ ...content, src: upload.url });
    else if (kind === 'video' && content.kind === 'video') {
      change({ ...content, src: upload.url, mimeType: upload.type });
    } else if (kind === 'captions' && content.kind === 'video') {
      change({ ...content, captionSrc: upload.url });
    } else throw new Error('Upload destination changed while uploading content.');
  }
  function uploadControl(kind: 'image' | 'video' | 'captions', src: string) {
    const label = i18n.t(
      `assessments.contentEditor.upload${
        kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : 'Captions'
      }`,
    );
    async function upload(file: File): Promise<AssetSelectionResult> {
      const error = validateUploadHintStructured(file, kind);
      if (error) return { _tag: 'error', error };
      props.onUploadBusy(true);
      try {
        applyUpload(kind, await uploadFile(file));
        return { _tag: 'ok' };
      } catch (_cause: unknown) {
        return { _tag: 'error', error: { code: 'processing-failed' } };
      } finally {
        props.onUploadBusy(false);
      }
    }
    return (
      <div class='space-y-2'>
        <AssetUpload
          accept={kind === 'captions' ? '.vtt,text/vtt' : `${kind}/*`}
          buttonLabel={label}
          busyLabel={i18n.t('editor.uploading')}
          helperText={i18n.t('assessments.contentEditor.fileLimit', {
            max: UPLOAD_POLICIES[kind].maxMebibytes,
          })}
          disabled={props.busy || props.frozen}
          onSelected={upload}
        />
        {src && (
          <p role='status' class='text-sm'>{i18n.t('assessments.contentEditor.fileUploaded')}</p>
        )}
      </div>
    );
  }
  function field(
    label: string,
    value: string,
    set: (value: string) => void,
    multiline = false,
    required = true,
  ) {
    return (
      <label class='flex flex-col gap-2'>
        <span class='text-sm font-medium'>{label}</span>
        {multiline
          ? (
            <Textarea
              rows={4}
              value={value}
              required={required}
              aria-describedby={props.error ? props.errorId : undefined}
              aria-invalid={props.invalid && required && !value.trim() ? true : undefined}
              disabled={props.frozen}
              onInput={(event) => set(event.currentTarget.value)}
            />
          )
          : (
            <Input
              value={value}
              required={required}
              aria-describedby={props.error ? props.errorId : undefined}
              aria-invalid={props.invalid && required && !value.trim() ? true : undefined}
              disabled={props.frozen}
              onInput={(event) => set(event.currentTarget.value)}
            />
          )}
      </label>
    );
  }
  const content = props.content;
  switch (content.kind) {
    case 'text':
      return (
        <>
          <label for={id} class='mb-2 block text-sm font-medium'>
            {i18n.t('assessments.textEditor.label')}
          </label>
          <Textarea
            id={id}
            name='text'
            rows={7}
            value={content.text}
            disabled={props.frozen}
            aria-describedby={`${id}-help${props.error ? ` ${props.errorId}` : ''}`}
            aria-invalid={props.invalid ? true : undefined}
            onInput={(event) => change({ ...content, text: event.currentTarget.value })}
          />
          <p id={`${id}-help`} class='mt-2 text-sm text-base-content/70'>
            {i18n.t('assessments.textEditor.help')}
          </p>
        </>
      );
    case 'image':
      return (
        <div class='space-y-4'>
          <p class='text-sm text-base-content/70'>
            {i18n.t('assessments.contentEditor.imageHelp')}
          </p>
          {uploadControl('image', content.src)}
          {content.src && (
            <img src={content.src} alt={content.alt} class='max-h-72 max-w-full rounded-lg' />
          )}
          {field(
            i18n.t('assessments.contentEditor.alt'),
            content.alt,
            (alt) => change({ ...content, alt }),
          )}
          {field(
            i18n.t('assessments.contentEditor.longDescription'),
            content.longDescription,
            (longDescription) => change({ ...content, longDescription }),
            true,
            false,
          )}
        </div>
      );
    case 'video':
      return (
        <div class='space-y-4'>
          <p class='text-sm text-base-content/70'>
            {i18n.t('assessments.contentEditor.videoHelp')}
          </p>
          {field(
            i18n.t('assessments.contentEditor.title'),
            content.title,
            (title) => change({ ...content, title }),
          )}
          {uploadControl('video', content.src)}
          {uploadControl('captions', content.captionSrc)}
          {field(
            i18n.t('assessments.contentEditor.captionLanguage'),
            content.captionLanguage,
            (captionLanguage) => change({ ...content, captionLanguage }),
          )}
          {field(
            i18n.t('assessments.contentEditor.transcript'),
            content.transcript,
            (transcript) => change({ ...content, transcript }),
            true,
          )}
        </div>
      );
    case 'video-link':
      return (
        <div class='space-y-4'>
          <p class='text-sm text-base-content/70'>{content.networkNotice}</p>
          {field(
            i18n.t('assessments.contentEditor.title'),
            content.title,
            (title) => change({ ...content, title }),
          )}
          {field(
            i18n.t('assessments.contentEditor.url'),
            content.url,
            (url) => change({ ...content, url }),
          )}
          {field(
            i18n.t('assessments.contentEditor.transcript'),
            content.transcript,
            (transcript) => change({ ...content, transcript }),
            true,
          )}
        </div>
      );
  }
}
