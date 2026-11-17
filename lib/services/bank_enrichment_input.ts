import { DOMParser } from '@xmldom/xmldom';
import { isEnrichmentRecord } from '../ai/bank_enrichment_config.ts';
import { isCanonicalUuid } from '../uuid.ts';
import type { EnrichmentResult } from './bank_enrichment_contract.ts';

/** Canonical single-choice content, retaining markup and the authoritative answer identity. */
export type EnrichmentQuestion = {
  readonly questionId: string;
  readonly revisionId: string;
  readonly title: string;
  readonly bodyHtml: string;
  readonly promptHtml: string;
  readonly choices: readonly {
    readonly id: string;
    readonly text: string;
    readonly html: string;
  }[];
  readonly correctId: string;
};
/** Maximum canonical question bytes reserved when selecting automatic teaching examples. */
export const ENRICHMENT_QUESTION_MAX_BYTES = 16_384;
/** Input failures become visible item outcomes, never guessed answers or truncated content. */
export type EnrichmentInputFailure = 'unsupported_content' | 'invalid_question' | 'input_too_large';

/** Parse the supported first-release content boundary without using driver answer defaults. */
export function prepareEnrichmentQuestion(
  questionId: string,
  revisionId: string,
  body: unknown,
): EnrichmentResult<EnrichmentQuestion, EnrichmentInputFailure> {
  if (!isCanonicalUuid(questionId) || !isCanonicalUuid(revisionId) || !isEnrichmentRecord(body)) {
    return { ok: false, code: 'invalid_question' };
  }
  if (body.type !== 'single_select') return { ok: false, code: 'unsupported_content' };
  if (new TextEncoder().encode(JSON.stringify(body)).length > ENRICHMENT_QUESTION_MAX_BYTES) {
    return { ok: false, code: 'input_too_large' };
  }
  if (
    typeof body.title !== 'string' || !body.title.trim() || !Array.isArray(body.choices) ||
    body.choices.length < 2 || body.choices.length > 12 || typeof body.correctId !== 'string'
  ) {
    return { ok: false, code: 'invalid_question' };
  }
  const bodyHtml = optionalText(body.bodyHtml);
  const promptHtml = optionalText(body.promptHtml);
  if (bodyHtml === null || promptHtml === null) return { ok: false, code: 'invalid_question' };
  const choices: EnrichmentQuestion['choices'][number][] = [];
  for (const choice of body.choices) {
    if (
      !isEnrichmentRecord(choice) || typeof choice.id !== 'string' || !choice.id.trim() ||
      choice.id.length > 128
    ) {
      return { ok: false, code: 'invalid_question' };
    }
    const text = optionalText(choice.text);
    const html = optionalText(choice.html);
    if (text === null || html === null) return { ok: false, code: 'invalid_question' };
    const content = inspectMarkup(html);
    if (content === null) return { ok: false, code: 'unsupported_content' };
    if (!text.trim() && !content.trim()) return { ok: false, code: 'invalid_question' };
    choices.push({ id: choice.id, text, html });
  }
  if (
    new Set(choices.map((choice) => choice.id)).size !== choices.length ||
    !choices.some((choice) => choice.id === body.correctId)
  ) return { ok: false, code: 'invalid_question' };
  const stem = inspectMarkup(bodyHtml);
  const prompt = inspectMarkup(promptHtml);
  if (stem === null || prompt === null) return { ok: false, code: 'unsupported_content' };
  if (!stem.trim() && !prompt.trim()) return { ok: false, code: 'invalid_question' };
  const value = {
    questionId,
    revisionId,
    title: body.title,
    bodyHtml,
    promptHtml,
    choices,
    correctId: body.correctId,
  };
  // Bound the canonical projection too: preview replay includes explicit optional text fields.
  if (new TextEncoder().encode(JSON.stringify(value)).length > ENRICHMENT_QUESTION_MAX_BYTES) {
    return { ok: false, code: 'input_too_large' };
  }
  return { ok: true, value };
}

function optionalText(value: unknown): string | null {
  return value === undefined ? '' : typeof value === 'string' ? value : null;
}

function inspectMarkup(html: string): string | null {
  if (!html) return '';
  let malformed = false;
  const doc = new DOMParser({
    errorHandler: {
      warning: () => {
        malformed = true;
      },
      error: () => {
        malformed = true;
      },
      fatalError: () => {
        malformed = true;
      },
    },
  }).parseFromString(`<div>${html}</div>`, 'text/html');
  if (malformed) return null;
  const allowed = new Set([
    'div',
    'p',
    'span',
    'b',
    'strong',
    'i',
    'em',
    'u',
    's',
    'sub',
    'sup',
    'br',
    'ul',
    'ol',
    'li',
    'blockquote',
  ]);
  for (const element of Array.from(doc.getElementsByTagName('*'))) {
    if (!allowed.has(element.tagName.toLowerCase())) return null;
    for (const attribute of Array.from(element.attributes)) {
      if (!['lang', 'dir', 'class', 'id', 'title'].includes(attribute.name.toLowerCase())) {
        return null;
      }
    }
  }
  return doc.documentElement.textContent ?? '';
}
