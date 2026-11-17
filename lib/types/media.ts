import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import { normalizePositiveDimension } from './authoring_normalization.ts';
import {
  isSupportedMediaPlayerControls,
  type QtiInteractionVocabulary,
  qtiStateFromInteractionVocabulary,
} from '../shared_vocabulary.ts';
import {
  type Qti3MediaAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
} from './qti3_writer_adapter.ts';

export type MediaSource = { src: string; type?: string };

/** Closed media-kind vocabulary shared by authoring types and runtime parsers. */
export const MEDIA_KINDS = ['audio', 'video', 'object'] as const;

/** Supported QTI media presentation kinds. */
export type MediaKind = (typeof MEDIA_KINDS)[number];

export type MediaDraft = {
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  responseIdentifier?: string;
  mediaKind?: MediaKind;
  mediaSources?: MediaSource[];
  mediaInteractionLabel?: string;
  mediaObjectLabel?: string;
  mediaCaptionSrc?: string;
  mediaCaptionLang?: string;
  mediaTranscript?: string;
  mediaAutostart?: boolean;
  mediaLoop?: boolean;
  mediaMinPlays?: number;
  mediaMaxPlays?: number;
  mediaCoords?: string;
  mediaWidth?: number;
  mediaHeight?: number;
  sharedVocabulary?: QtiInteractionVocabulary;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

export function defaultsMedia(): MediaDraft {
  return {
    title: 'Media Interaction',
    promptHtml: '<p>Play the media.</p>',
    bodyHtml: '<p>Listen or watch the media clip.</p>',
    responseIdentifier: 'RESPONSE',
    mediaKind: 'video',
    mediaSources: [],
    mediaCaptionSrc: '',
    mediaCaptionLang: 'en',
    mediaTranscript: '',
    mediaInteractionLabel: '',
    mediaAutostart: false,
    mediaLoop: false,
    mediaMinPlays: 0,
    mediaMaxPlays: 0,
    sharedVocabulary: { mediaPlayerControls: ['default'] },
  };
}

export function validateMedia(draft: MediaDraft): string[] {
  const errs: string[] = [];
  if (!draft.title?.trim()) errs.push('Title is required.');

  const responseId = (draft.responseIdentifier ?? 'RESPONSE').trim();
  if (!isValidQtiIdentifier(responseId)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }

  const sources = normalizeSources(draft.mediaSources);
  if (!sources.length) errs.push('Add at least one media source.');
  for (const source of sources) {
    if (!source.src.trim()) errs.push('Media source URL is required.');
  }
  const captionSrc = (draft.mediaCaptionSrc ?? '').trim();
  if (captionSrc && !/\.vtt(\?|#|$)/i.test(captionSrc)) {
    errs.push('Captions source must be a .vtt file URL.');
  }

  if (draft.mediaAutostart == null) errs.push('Autostart must be set.');

  if (typeof draft.mediaMinPlays === 'number' && draft.mediaMinPlays < 0) {
    errs.push('Minimum plays must be 0 or greater.');
  }
  if (typeof draft.mediaMaxPlays === 'number' && draft.mediaMaxPlays < 0) {
    errs.push('Maximum plays must be 0 or greater.');
  }
  if (
    typeof draft.mediaMinPlays === 'number' &&
    typeof draft.mediaMaxPlays === 'number' &&
    draft.mediaMaxPlays > 0 &&
    draft.mediaMinPlays > draft.mediaMaxPlays
  ) {
    errs.push('Minimum plays must be less than or equal to maximum plays.');
  }

  const width = draft.mediaWidth;
  if (width != null && (!Number.isFinite(width) || Number(width) <= 0)) {
    errs.push('Media width must be a positive number.');
  }
  const height = draft.mediaHeight;
  if (height != null && (!Number.isFinite(height) || Number(height) <= 0)) {
    errs.push('Media height must be a positive number.');
  }
  const playerControls = draft.sharedVocabulary?.mediaPlayerControls;
  if (
    playerControls?.length &&
    !playerControls.every((token) => isSupportedMediaPlayerControls(token))
  ) {
    errs.push('Media player controls must use a supported QTI shared vocabulary token.');
  }
  const pauseDelay = draft.sharedVocabulary?.mediaPauseDelay;
  if (
    pauseDelay != null &&
    (!Number.isFinite(pauseDelay) || pauseDelay < 0)
  ) {
    errs.push('Media pause delay must be 0 or greater.');
  }
  const pauseDuration = draft.sharedVocabulary?.mediaPauseDuration;
  if (
    pauseDuration != null &&
    (!Number.isFinite(pauseDuration) || pauseDuration < 0)
  ) {
    errs.push('Media pause duration must be 0 or greater.');
  }

  return errs;
}

export function toQti3MediaAuthoringItem(
  draft: MediaDraft,
  opts: BuildOptions,
): Qti3MediaAuthoringItem {
  return {
    interactionType: 'media',
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    kind: draft.mediaKind ?? 'video',
    sources: normalizeSources(draft.mediaSources),
    interactionLabel: draft.mediaInteractionLabel,
    objectLabel: draft.mediaObjectLabel,
    captionSrc: (draft.mediaCaptionSrc ?? '').trim() || undefined,
    captionLang: (draft.mediaCaptionLang ?? 'en').trim() || 'en',
    transcript: (draft.mediaTranscript ?? '').trim() || undefined,
    autostart: draft.mediaAutostart === true,
    loop: draft.mediaLoop === true,
    minPlays: normalizeBound(draft.mediaMinPlays),
    maxPlays: normalizeBound(draft.mediaMaxPlays),
    coords: (draft.mediaCoords ?? '').trim() || undefined,
    width: normalizePositiveDimension(draft.mediaWidth),
    height: normalizePositiveDimension(draft.mediaHeight),
    sharedVocabulary: draft.sharedVocabulary
      ? qtiStateFromInteractionVocabulary(draft.sharedVocabulary)
      : undefined,
  };
}

function normalizeSources(sources?: MediaSource[]): MediaSource[] {
  if (!Array.isArray(sources)) return [];
  return sources
    .map((source) => ({ src: source.src ?? '', type: source.type ?? undefined }))
    .filter((source) => source.src.trim().length > 0);
}

function normalizeBound(value?: number): number | undefined {
  if (value == null) return undefined;
  if (!Number.isFinite(value)) return undefined;
  const intVal = Math.trunc(value);
  if (intVal === 0) return undefined;
  if (intVal < 0) return 0;
  return intVal;
}
