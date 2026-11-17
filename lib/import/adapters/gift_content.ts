import { sanitizeBodyHtml, sanitizeInlineHtml } from '../../sanitize.ts';
import { xmlEscape } from '../../xml.ts';
import type { ImportWarning } from '../types.ts';
import { unescapeGift } from './gift_tokens.ts';
export type GiftContentFormat = 'plain' | 'html';
/** Read format metadata before interpreting the question and its answer blocks. */
export function readGiftFormat(
  input: string,
  warnings: ImportWarning[],
): { content: string; format: GiftContentFormat } {
  const marker = /^\[(html|plain|markdown|moodle)\]/i.exec(input);
  if (!marker) return { content: input, format: 'plain' };
  const label = marker[1].toLowerCase();
  if (label !== 'html' && label !== 'plain') {
    warnings.push({
      code: 'LMS_CONTENT_REVIEW',
      message:
        `GIFT ${label} formatting is retained as literal text. Reapply its formatting explicitly before delivery.`,
    });
  }
  return { content: input.slice(marker[0].length), format: label === 'html' ? 'html' : 'plain' };
}
/** Untrusted fragments are sanitized only after assembling the complete question body. */
export function giftContentFragment(text: string, format: GiftContentFormat): string {
  return format === 'html'
    ? unescapeGift(text)
    : xmlEscape(unescapeGift(text)).replace(/\n+/g, '<br>');
}
export function giftBodyHtml(text: string, format: GiftContentFormat): string {
  const html = giftContentFragment(text.trim(), format);
  return sanitizeBodyHtml(format === 'html' ? html : `<p>${html}</p>`) || '<p></p>';
}
export function giftChoiceContent(
  text: string,
  format: GiftContentFormat,
  warnings: ImportWarning[],
): { text: string } | { html: string } {
  const field = /^\[(html|plain|markdown|moodle)\]/i.test(text)
    ? readGiftFormat(text, warnings)
    : { content: text, format };
  return field.format === 'html'
    ? { html: sanitizeInlineHtml(field.content) }
    : { text: field.content };
}
