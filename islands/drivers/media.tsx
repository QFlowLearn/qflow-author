import { useEffect } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import { setDraftFieldValue, setDraftListFieldValue } from './editor_shell.tsx';
import Button from '../../components/ui/Button.tsx';
import type { ImageCompositionContext } from '../../components/ui/ImageQuestionCompositionPreview.tsx';
import Input from '../../components/ui/Input.tsx';
import MediaFileUpload from '../../components/ui/MediaFileUpload.tsx';
import Select from '../../components/ui/Select.tsx';
import Textarea from '../../components/ui/Textarea.tsx';
import type { DriverUiContext } from './view_registry.ts';
import type { MediaKind, MediaSource } from '../../lib/types/media.ts';
import { defaultsMedia } from '../../lib/types/media.ts';
import type { CommonContentProps } from './types.ts';
import { ResponseIdentifierDisclosure } from './response_identifier_disclosure.tsx';
import { attachStandardDriverViews } from './standard_driver_views.ts';

export type MediaContentProps = CommonContentProps & {
  imageComposition: ImageCompositionContext;
  responseIdentifier: string;
  mediaKind: MediaKind;
  mediaSources: MediaSource[];
  mediaCaptionSrc: string;
  mediaCaptionLang: string;
  mediaTranscript: string;
  mediaObjectLabel: string;

  setResponseIdentifier: (id: string) => void;
  setMediaKind: (kind: MediaKind) => void;
  setMediaCaptionSrc: (src: string) => void;
  setMediaCaptionLang: (lang: string) => void;
  setMediaTranscript: (transcript: string) => void;
  setMediaObjectLabel: (label: string) => void;

  setPrimaryMediaSource: (source: MediaSource) => void;
  clearPrimaryMediaSource: () => void;
  addMediaSource: () => void;
  updateMediaSourceSrc: (index: number, src: string) => void;
  updateMediaSourceType: (index: number, type: string) => void;
  removeMediaSource: (index: number) => void;
};

function MediaEditor(ctx: DriverUiContext<'media'>) {
  const { editor, draft, update } = ctx;
  const mediaSources = draft.mediaSources ?? [];
  const mediaKind = draft.mediaKind ?? 'video';

  const setDraftField = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K] | ((prev: (typeof draft)[K]) => (typeof draft)[K]),
  ) => setDraftFieldValue(editor, draft, update, key, value);

  useEffect(() => {
    if (draft.mediaSources !== undefined) return;
    const defaults = defaultsMedia();
    update({
      ...draft,
      responseIdentifier: draft.responseIdentifier ?? defaults.responseIdentifier ?? 'RESPONSE',
      mediaKind: draft.mediaKind ?? defaults.mediaKind ?? 'video',
      mediaSources: defaults.mediaSources ?? [],
      mediaCaptionSrc: draft.mediaCaptionSrc ?? defaults.mediaCaptionSrc ?? '',
      mediaCaptionLang: draft.mediaCaptionLang ?? defaults.mediaCaptionLang ?? 'en',
      mediaTranscript: draft.mediaTranscript ?? defaults.mediaTranscript ?? '',
      mediaObjectLabel: draft.mediaObjectLabel ?? defaults.mediaObjectLabel ?? '',
      mediaInteractionLabel: draft.mediaInteractionLabel ?? defaults.mediaInteractionLabel ?? '',
      mediaAutostart: draft.mediaAutostart ?? defaults.mediaAutostart ?? false,
      mediaLoop: draft.mediaLoop ?? defaults.mediaLoop ?? false,
      mediaMinPlays: draft.mediaMinPlays ?? defaults.mediaMinPlays ?? 0,
      mediaMaxPlays: draft.mediaMaxPlays ?? defaults.mediaMaxPlays ?? 0,
    });
  }, [draft.mediaSources]);

  const setResponseIdentifier = (value: string) => setDraftField('responseIdentifier', value);
  const setMediaKind = (value: MediaKind) => {
    setDraftField('mediaKind', value);
    editor.onSettingsChange?.({ mediaKind: value });
  };
  const setMediaCaptionSrc = (value: string) => setDraftField('mediaCaptionSrc', value);
  const setMediaCaptionLang = (value: string) => setDraftField('mediaCaptionLang', value);
  const setMediaTranscript = (value: string) => setDraftField('mediaTranscript', value);
  const setMediaObjectLabel = (value: string) => setDraftField('mediaObjectLabel', value);

  const addMediaSource = () =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'mediaSources',
      (prev) => [...prev, { src: '', type: '' }],
    );

  const setPrimaryMediaSource = (source: MediaSource) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'mediaSources',
      (prev) => prev.length ? [source, ...prev.slice(1)] : [source],
    );

  const clearPrimaryMediaSource = () =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'mediaSources',
      (prev) => prev.slice(1),
    );

  const updateMediaSourceSrc = (index: number, src: string) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'mediaSources',
      (prev) => prev.map((source, idx) => (idx === index ? { ...source, src } : source)),
    );

  const updateMediaSourceType = (index: number, type: string) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'mediaSources',
      (prev) => prev.map((source, idx) => (idx === index ? { ...source, type } : source)),
    );

  const removeMediaSource = (index: number) =>
    setDraftListFieldValue(
      editor,
      draft,
      update,
      'mediaSources',
      (prev) => prev.filter((_, idx) => idx !== index),
    );

  return (
    <MediaContent
      renderPromptField={editor.renderPromptField ?? (() => null)}
      fieldHasIssue={editor.fieldHasIssue ?? (() => false)}
      fieldIssueText={editor.fieldIssueText ?? (() => undefined)}
      imageComposition={{
        bodyHtml: draft.bodyHtml ?? '',
        promptHtml: draft.promptHtml ?? '',
        accessibleDescription: draft.mediaObjectLabel ?? '',
      }}
      responseIdentifier={draft.responseIdentifier ?? 'RESPONSE'}
      mediaKind={mediaKind}
      mediaSources={mediaSources}
      mediaCaptionSrc={draft.mediaCaptionSrc ?? ''}
      mediaCaptionLang={draft.mediaCaptionLang ?? 'en'}
      mediaTranscript={draft.mediaTranscript ?? ''}
      mediaObjectLabel={draft.mediaObjectLabel ?? ''}
      setResponseIdentifier={setResponseIdentifier}
      setMediaKind={setMediaKind}
      setMediaCaptionSrc={setMediaCaptionSrc}
      setMediaCaptionLang={setMediaCaptionLang}
      setMediaTranscript={setMediaTranscript}
      setMediaObjectLabel={setMediaObjectLabel}
      setPrimaryMediaSource={setPrimaryMediaSource}
      clearPrimaryMediaSource={clearPrimaryMediaSource}
      addMediaSource={addMediaSource}
      updateMediaSourceSrc={updateMediaSourceSrc}
      updateMediaSourceType={updateMediaSourceType}
      removeMediaSource={removeMediaSource}
    />
  );
}

export function MediaContent(props: MediaContentProps) {
  const i18n = useI18n();
  return (
    <div class='space-y-5'>
      {props.renderPromptField(i18n.t('driver.mediaPrompt'))}
      <ResponseIdentifierDisclosure
        value={props.responseIdentifier}
        onChange={props.setResponseIdentifier}
      />

      <div class='grid gap-3 sm:grid-cols-2'>
        <label class='flex flex-col'>
          <span>{i18n.t('driver.mediaOpeningLabel')}</span>
          <Select
            value={props.mediaKind}
            onInput={(e) => props.setMediaKind((e.target as HTMLSelectElement).value as MediaKind)}
          >
            <option value='video'>{i18n.t('driver.mediaVideo')}</option>
            <option value='audio'>{i18n.t('driver.mediaAudio')}</option>
            <option value='object'>{i18n.t('driver.mediaImageDocument')}</option>
          </Select>
        </label>
      </div>

      <div class='space-y-2'>
        <strong class='block text-sm text-base-content/80'>{i18n.t('driver.mediaFile')}</strong>
        <MediaFileUpload
          kind={props.mediaKind}
          source={props.mediaSources[0]}
          imageComposition={props.imageComposition}
          onChange={props.setPrimaryMediaSource}
          onClear={props.clearPrimaryMediaSource}
        />
      </div>

      {props.mediaKind === 'object' && (
        <label class='flex flex-col max-w-2xl'>
          <span>{i18n.t('driver.mediaAccessibleDescription')}</span>
          <Input
            value={props.mediaObjectLabel}
            onInput={(event) => props.setMediaObjectLabel(event.currentTarget.value)}
            placeholder={i18n.t('driver.mediaAccessibleDescriptionPlaceholder')}
          />
          <span class='mt-1 text-xs text-base-content/70'>
            {i18n.t('driver.mediaAccessibleDescriptionHelp')}
          </span>
        </label>
      )}

      <details class='rounded-lg border border-base-300 bg-base-100'>
        <summary class='cursor-pointer px-4 py-3 text-sm font-medium'>
          {i18n.t('driver.mediaAdvancedSettings')}
        </summary>
        <div class='space-y-3 border-t border-base-200 p-4'>
          <div class='flex flex-wrap items-center justify-between gap-2'>
            <p class='max-w-2xl text-sm text-base-content/70'>
              {i18n.t('driver.mediaAdvancedHelp')}
            </p>
            <Button size='sm' type='button' onClick={props.addMediaSource}>
              {i18n.t('driver.mediaAddAlternate')}
            </Button>
          </div>
          {props.mediaSources.length === 0 && (
            <p class='text-sm text-base-content/70'>{i18n.t('driver.mediaNoSources')}</p>
          )}
          <div class='space-y-2'>
            {props.mediaSources.map((source, index) => (
              <div
                key={`media-source-${index}`}
                class='grid gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center'
              >
                <label class='flex flex-col'>
                  <span class='text-xs'>
                    {index === 0
                      ? i18n.t('driver.mediaPrimarySource')
                      : i18n.t('driver.mediaAlternateSource')}
                  </span>
                  <Input
                    size='sm'
                    value={source.src ?? ''}
                    onInput={(e) =>
                      props.updateMediaSourceSrc(index, (e.target as HTMLInputElement).value)}
                    placeholder='assets/media.mp4'
                  />
                </label>
                <label class='flex flex-col'>
                  <span class='text-xs'>{i18n.t('driver.mediaMimeType')}</span>
                  <Input
                    size='sm'
                    value={source.type ?? ''}
                    onInput={(e) =>
                      props.updateMediaSourceType(index, (e.target as HTMLInputElement).value)}
                    placeholder='video/mp4'
                  />
                </label>
                <Button
                  size='xs'
                  variant='danger-ghost'
                  type='button'
                  aria-label={i18n.t('driver.mediaRemoveSource', { number: index + 1 })}
                  onClick={() => props.removeMediaSource(index)}
                >
                  {i18n.t('driver.mediaRemoveSourceVisible')}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </details>

      {(props.mediaKind === 'video' || props.mediaKind === 'audio') && (
        <div class='grid gap-3 sm:grid-cols-2'>
          <label class='flex flex-col'>
            <span>{i18n.t('driver.mediaCaptions')}</span>
            <Input
              value={props.mediaCaptionSrc}
              onInput={(e) => props.setMediaCaptionSrc((e.target as HTMLInputElement).value)}
              placeholder='assets/captions.vtt'
            />
          </label>
          <label class='flex flex-col'>
            <span>{i18n.t('driver.mediaCaptionLanguage')}</span>
            <Input
              value={props.mediaCaptionLang}
              onInput={(e) => props.setMediaCaptionLang((e.target as HTMLInputElement).value)}
              placeholder='en'
            />
          </label>
          <label class='flex flex-col sm:col-span-2'>
            <span>{i18n.t('driver.mediaTranscript')}</span>
            <Textarea
              value={props.mediaTranscript}
              onInput={(e) => props.setMediaTranscript((e.target as HTMLTextAreaElement).value)}
              placeholder={i18n.t('driver.mediaTranscriptPlaceholder')}
            />
          </label>
        </div>
      )}
    </div>
  );
}

attachStandardDriverViews('media', MediaEditor);
