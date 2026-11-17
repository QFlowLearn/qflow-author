import { safeMediaUrl } from './client/safe_media_url.ts';
import { packageAssetKey } from './asset_refs.ts';

/** Unscored plain text: punctuation and URLs remain literal text, never executable markup. */
export type AssessmentTextContent = {
  readonly kind: 'text';
  readonly text: string;
};

/** One assessment-local content anchor without a question, response or answer key. */
export type AssessmentTextPlacement = {
  readonly id: string;
  readonly content: AssessmentTextContent;
  readonly fixed: true;
};

/** Parse the exact serialized text payload before it enters ordering or persistence. */
export function parseAssessmentTextContent(value: unknown):
  | { readonly ok: true; readonly content: AssessmentTextContent }
  | { readonly ok: false; readonly code: 'invalid_text_content' } {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    Object.keys(value).some((key) => key !== 'kind' && key !== 'text') ||
    !('kind' in value) || value.kind !== 'text' ||
    !('text' in value) || typeof value.text !== 'string' ||
    !value.text.trim() || Array.from(value.text).length > 100_000 ||
    // oxlint-disable-next-line no-control-regex -- XML 1.0 forbids these controls and unpaired surrogates.
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/u.test(value.text)
  ) return { ok: false, code: 'invalid_text_content' };
  return { ok: true, content: { kind: 'text', text: value.text } };
}

/** An owned image with a useful short description and optional longer explanation. */
export type AssessmentImageContent = {
  readonly kind: 'image';
  readonly src: string;
  readonly alt: string;
  readonly longDescription: string;
};

/** A packaged video is optional to play and has captions plus an equivalent transcript. */
export type AssessmentVideoContent = {
  readonly kind: 'video';
  readonly src: string;
  readonly mimeType: string;
  readonly title: string;
  readonly captionSrc: string;
  readonly captionLanguage: string;
  readonly transcript: string;
};

/** An explicitly online video link; executable embeds never enter the content model. */
export type AssessmentVideoLinkContent = {
  readonly kind: 'video-link';
  readonly url: string;
  readonly title: string;
  readonly transcript: string;
  readonly networkNotice: string;
};

/** One canonical unscored block, independent of any learner response or scoring declaration. */
export type AssessmentStandaloneContent =
  | AssessmentTextContent
  | AssessmentImageContent
  | AssessmentVideoContent
  | AssessmentVideoLinkContent;

/** Every content variant retains an assessment-local ordered anchor. */
export type AssessmentContentPlacement = {
  readonly id: string;
  readonly content: AssessmentStandaloneContent;
  readonly fixed: true;
};

/** Parse only supported canonical content and exact fields at persistence/request boundaries. */
export function parseAssessmentStandaloneContent(value: unknown):
  | { readonly ok: true; readonly content: AssessmentStandaloneContent }
  | { readonly ok: false; readonly code: 'invalid_content' } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('kind' in value)) {
    return { ok: false, code: 'invalid_content' };
  }
  if (value.kind === 'text') {
    const parsed = parseAssessmentTextContent(value);
    return parsed.ok ? parsed : { ok: false, code: 'invalid_content' };
  }
  if (
    value.kind === 'image' && exact(value, ['kind', 'src', 'alt', 'longDescription']) &&
    'src' in value && assetReference(value.src) &&
    'alt' in value && literal(value.alt, 2000) &&
    'longDescription' in value && literal(value.longDescription, 100_000, true)
  ) {
    return {
      ok: true,
      content: {
        kind: 'image',
        src: value.src,
        alt: value.alt,
        longDescription: value.longDescription,
      },
    };
  }
  if (
    value.kind === 'video' &&
    exact(value, [
      'kind',
      'src',
      'mimeType',
      'title',
      'captionSrc',
      'captionLanguage',
      'transcript',
    ]) &&
    'src' in value && assetReference(value.src) &&
    'mimeType' in value && typeof value.mimeType === 'string' &&
    ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-m4v'].includes(
      value.mimeType,
    ) &&
    'title' in value && literal(value.title, 2000) &&
    'captionSrc' in value && assetReference(value.captionSrc) &&
    'captionLanguage' in value && typeof value.captionLanguage === 'string' &&
    /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value.captionLanguage) &&
    'transcript' in value && literal(value.transcript, 100_000)
  ) {
    return {
      ok: true,
      content: {
        kind: 'video',
        src: value.src,
        mimeType: value.mimeType,
        title: value.title,
        captionSrc: value.captionSrc,
        captionLanguage: value.captionLanguage,
        transcript: value.transcript,
      },
    };
  }
  if (
    value.kind === 'video-link' &&
    exact(value, ['kind', 'url', 'title', 'transcript', 'networkNotice']) &&
    'url' in value && supportedOnlineVideoUrl(value.url) &&
    'title' in value && literal(value.title, 2000) &&
    'transcript' in value && literal(value.transcript, 100_000) &&
    'networkNotice' in value && literal(value.networkNotice, 2000)
  ) {
    return {
      ok: true,
      content: {
        kind: 'video-link',
        url: value.url,
        title: value.title,
        transcript: value.transcript,
        networkNotice: value.networkNotice,
      },
    };
  }
  return { ok: false, code: 'invalid_content' };
}

function exact(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function literal(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && Array.from(value).length <= max &&
    ((allowEmpty && value === '') || parseAssessmentTextContent({ kind: 'text', text: value }).ok);
}

function assetReference(value: unknown): value is string {
  return literal(value, 2048) && value === value.trim() &&
    (safeMediaUrl(value) === value ||
      (packageAssetKey(value) !== null && safeMediaUrl(`/${value}`) !== null)) &&
    !value.startsWith('data:') && !value.startsWith('blob:') && !value.startsWith('#');
}

/** Only HTTPS YouTube/Vimeo links are supported, with no credentials or executable embed input. */
export function supportedOnlineVideoUrl(value: unknown): value is string {
  if (
    !literal(value, 2048) || safeMediaUrl(value) !== value || value !== value.trim() ||
    !/^https:\/\/((www\.)?(youtube\.com|vimeo\.com)|youtu\.be)\/\S*$/i.test(value)
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['youtube.com', 'www.youtube.com', 'youtu.be', 'vimeo.com', 'www.vimeo.com'].includes(
        url.hostname,
      );
  } catch (_cause: unknown) {
    return false;
  }
}

/** Unsaved editor fields share the serialized shape; the parser establishes valid content at save. */
export function emptyAssessmentContentDraft(
  kind: AssessmentStandaloneContent['kind'],
  language: string,
  networkNotice: string,
): AssessmentStandaloneContent {
  switch (kind) {
    case 'text':
      return { kind, text: '' };
    case 'image':
      return { kind, src: '', alt: '', longDescription: '' };
    case 'video':
      return {
        kind,
        src: '',
        mimeType: '',
        title: '',
        captionSrc: '',
        captionLanguage: language,
        transcript: '',
      };
    case 'video-link':
      return { kind, url: '', title: '', transcript: '', networkNotice };
  }
}
