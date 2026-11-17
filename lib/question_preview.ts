import { sanitizeBodyHtml, type SanitizedHtml, sanitizeInlineHtml } from './sanitize.ts';
import type { Draft } from './types/draft.ts';

/** Compact question content for collapsed assessment authoring cards. */
export type QuestionPreview = {
  readonly bodyHtml?: SanitizedHtml;
  readonly promptHtml?: SanitizedHtml;
  readonly choices?: ReadonlyArray<{ readonly id: string; readonly text: string }>;
};

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Projects a typed authoring draft into compact preview content. */
export function projectQuestionPreviewFromDraft(draft: Draft): QuestionPreview {
  return {
    bodyHtml: draft.bodyHtml === undefined ? undefined : sanitizeBodyHtml(draft.bodyHtml),
    promptHtml: draft.promptHtml === undefined ? undefined : sanitizeInlineHtml(draft.promptHtml),
    choices: draft.choices?.map((choice) => ({
      id: choice.id,
      text: choice.text ?? (choice.html ? stripHtml(choice.html) : ''),
    })),
  };
}
