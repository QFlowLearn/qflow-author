import { sanitizeBodyHtml } from '../sanitize.ts';
import { isValidQtiIdentifier } from '../qti_identifiers.ts';
import type { ItemLanguage } from './item_language.ts';
import {
  type Qti3UploadAuthoringItem,
  sanitizedQti3BodyFragment,
  sanitizedQti3InlineFragment,
  trustedQti3Fragment,
} from './qti3_writer_adapter.ts';

export type UploadDraft = {
  externalScored?: 'human';
  rubricHtml?: string;
  title: string;
  promptHtml?: string;
  bodyHtml?: string;
  responseIdentifier?: string;
  uploadMaxFileSize?: number;
  uploadFileTypes?: string;
  uploadMultiple?: boolean;
  uploadClassName?: string;
};

export type BuildOptions = { identifier?: string; lang: ItemLanguage };

export function defaultsUpload(): UploadDraft {
  return {
    title: 'Upload',
    promptHtml: '<p>Upload the requested file.</p>',
    bodyHtml: '<p>Provide a file that satisfies the prompt.</p>',
    responseIdentifier: 'RESPONSE',
    uploadMaxFileSize: undefined,
    uploadFileTypes: '',
    uploadMultiple: false,
    uploadClassName: '',
  };
}

export function validateUpload(draft: UploadDraft): string[] {
  const errs: string[] = [];
  if (draft.externalScored !== undefined && draft.externalScored !== 'human') {
    errs.push('Upload external scoring must be human.');
  }
  if (!draft.title?.trim()) errs.push('Title is required.');

  const bodyText = (draft.bodyHtml ?? '').replace(/<[^>]*>/g, '').trim();
  if (!bodyText) errs.push('Body is required.');

  const responseId = (draft.responseIdentifier ?? 'RESPONSE').trim();
  if (!isValidQtiIdentifier(responseId)) {
    errs.push('Response identifier must be a valid QTI identifier.');
  }

  if (
    draft.uploadMaxFileSize != null &&
    (!Number.isFinite(draft.uploadMaxFileSize) || draft.uploadMaxFileSize <= 0)
  ) {
    errs.push('Max file size must be a positive number.');
  }

  return errs;
}

export function toQti3UploadAuthoringItem(
  draft: UploadDraft,
  opts: BuildOptions,
): Qti3UploadAuthoringItem {
  const className = (draft.uploadClassName ?? '').trim();
  return {
    interactionType: 'upload',
    externalScored: draft.externalScored,
    rubricHtml: draft.rubricHtml
      ? trustedQti3Fragment(sanitizeBodyHtml(draft.rubricHtml))
      : undefined,
    identifier: opts.identifier ?? `item-${crypto.randomUUID()}`,
    title: draft.title || 'Untitled',
    lang: opts.lang,
    bodyHtml: sanitizedQti3BodyFragment(draft.bodyHtml),
    promptHtml: sanitizedQti3InlineFragment(draft.promptHtml),
    responseIdentifier: draft.responseIdentifier ?? 'RESPONSE',
    maxFileSize: normalizePositiveInteger(draft.uploadMaxFileSize),
    fileTypes: (draft.uploadFileTypes ?? '').trim() || undefined,
    multiple: Boolean(draft.uploadMultiple),
    classNames: className ? className.split(/\s+/) : undefined,
  };
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.trunc(value);
}
