import type { AssessmentStandaloneContent } from './assessment_standalone_content.ts';
import { parseAssessmentStandaloneContent } from './assessment_standalone_content.ts';
import { sanitizeInlineHtml } from './sanitize.ts';
import { xmlEscape } from './xml.ts';

export type AnswerFeedbackMedia = Exclude<AssessmentStandaloneContent, { readonly kind: 'text' }>;
export type AnswerFeedbackLink = { readonly url: string; readonly label: string };
/** One optional explanation selected by the complete response, independently of its numeric score. */
export type AnswerFeedbackExplanation = {
  readonly text: string;
  readonly link: AnswerFeedbackLink | null;
  readonly media: AnswerFeedbackMedia | null;
};
export type AnswerFeedback = {
  readonly correct: AnswerFeedbackExplanation | null;
  readonly incorrect: AnswerFeedbackExplanation | null;
};
export type AnswerFeedbackParseResult =
  | { readonly ok: true; readonly value: AnswerFeedback }
  | { readonly ok: false; readonly code: 'invalid_answer_feedback' };

/** Parse exact explanation fields; arbitrary rich markup or embedded programs never enter this model. */
export function parseAnswerFeedback(value: unknown): AnswerFeedbackParseResult {
  if (!record(value, ['correct', 'incorrect'])) return invalid();
  const correct = explanation(value.correct), incorrect = explanation(value.incorrect);
  if (correct === false || incorrect === false || (!correct && !incorrect)) return invalid();
  return { ok: true, value: { correct, incorrect } };
}

export function emptyAnswerFeedbackExplanation(): AnswerFeedbackExplanation {
  return { text: '', link: null, media: null };
}

/** Apply the existing link sanitizer plus the explicit public HTTPS policy for authored explanations. */
export function safeAnswerFeedbackLink(url: string): boolean {
  if (url.length > 2048 || url !== url.trim() || !url.startsWith('https://')) return false;
  if (
    Array.from(url).some((character) =>
      character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127
    )
  ) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
      return false;
    }
    return sanitizeInlineHtml(`<a href="${xmlEscape(url)}">Link</a>`).includes('href=');
  } catch (_cause: unknown) {
    return false;
  }
}

function explanation(value: unknown): AnswerFeedbackExplanation | null | false {
  if (value === null) return null;
  if (!record(value, ['text', 'link', 'media']) || !literal(value.text, 100_000, true)) {
    return false;
  }
  let link: AnswerFeedbackLink | null = null;
  if (value.link !== null) {
    if (
      !record(value.link, ['url', 'label']) || typeof value.link.url !== 'string' ||
      !safeAnswerFeedbackLink(value.link.url) || !literal(value.link.label, 2000, false)
    ) return false;
    link = { url: value.link.url, label: value.link.label };
  }
  let media: AnswerFeedbackMedia | null = null;
  if (value.media !== null) {
    const parsed = parseAssessmentStandaloneContent(value.media);
    if (!parsed.ok || parsed.content.kind === 'text') return false;
    media = parsed.content;
  }
  if (!value.text.trim() && !link && !media) return false;
  return { text: value.text, link, media };
}
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function literal(value: unknown, maximum: number, empty: boolean): value is string {
  return typeof value === 'string' && Array.from(value).length <= maximum &&
    (empty || !!value.trim()) &&
    // oxlint-disable-next-line no-control-regex -- XML 1.0 cannot represent these code points.
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/u.test(value);
}
function invalid(): AnswerFeedbackParseResult {
  return { ok: false, code: 'invalid_answer_feedback' };
}

/** Retain incomplete editor input in autosaved drafts; publication separately validates semantics. */
export function parseAnswerFeedbackDraft(value: unknown): AnswerFeedbackParseResult {
  if (!record(value, ['correct', 'incorrect'])) return invalid();
  const correct = draftExplanation(value.correct), incorrect = draftExplanation(value.incorrect);
  if (correct === false || incorrect === false || (!correct && !incorrect)) return invalid();
  return { ok: true, value: { correct, incorrect } };
}
function draftExplanation(value: unknown): AnswerFeedbackExplanation | null | false {
  if (value === null) return null;
  if (!record(value, ['text', 'link', 'media']) || !literal(value.text, 100_000, true)) {
    return false;
  }
  let link: AnswerFeedbackLink | null = null;
  if (value.link !== null) {
    if (
      !record(value.link, ['url', 'label']) || !literal(value.link.url, 2048, true) ||
      !literal(value.link.label, 2000, true)
    ) return false;
    link = { url: value.link.url, label: value.link.label };
  }
  const media = draftMedia(value.media);
  if (media === false) return false;
  return { text: value.text, link, media };
}
function draftMedia(value: unknown): AnswerFeedbackMedia | null | false {
  if (value === null) return null;
  if (!openRecord(value)) return false;
  switch (value.kind) {
    case 'image':
      if (
        !record(value, ['kind', 'src', 'alt', 'longDescription']) ||
        !literal(value.src, 2048, true) || !literal(value.alt, 2000, true) ||
        !literal(value.longDescription, 100_000, true)
      ) return false;
      return {
        kind: 'image',
        src: value.src,
        alt: value.alt,
        longDescription: value.longDescription,
      };
    case 'video':
      if (
        !record(value, [
          'kind',
          'src',
          'mimeType',
          'title',
          'captionSrc',
          'captionLanguage',
          'transcript',
        ]) || !literal(value.src, 2048, true) || !literal(value.mimeType, 100, true) ||
        !literal(value.title, 2000, true) || !literal(value.captionSrc, 2048, true) ||
        !literal(value.captionLanguage, 100, true) || !literal(value.transcript, 100_000, true)
      ) return false;
      return {
        kind: 'video',
        src: value.src,
        mimeType: value.mimeType,
        title: value.title,
        captionSrc: value.captionSrc,
        captionLanguage: value.captionLanguage,
        transcript: value.transcript,
      };
    case 'video-link':
      if (
        !record(value, ['kind', 'url', 'title', 'transcript', 'networkNotice']) ||
        !literal(value.url, 2048, true) || !literal(value.title, 2000, true) ||
        !literal(value.transcript, 100_000, true) || !literal(value.networkNotice, 2000, true)
      ) return false;
      return {
        kind: 'video-link',
        url: value.url,
        title: value.title,
        transcript: value.transcript,
        networkNotice: value.networkNotice,
      };
    default:
      return false;
  }
}

function openRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
