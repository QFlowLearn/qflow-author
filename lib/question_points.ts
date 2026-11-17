import type { InterfaceLocale } from './i18n/locale.ts';

/** Transient input spelling may be incomplete without contaminating the canonical numeric draft. */
export type QuestionPointsInput =
  | { readonly _tag: 'Unset' }
  | { readonly _tag: 'Value'; readonly value: number }
  | { readonly _tag: 'Invalid' };

function decimalSeparator(locale: InterfaceLocale): string {
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1)
    .find((part) => part.type === 'decimal')?.value;
  if (!decimal) throw new Error('The configured locale has no decimal separator.');
  return decimal;
}

/** Input accepts the interface decimal separator and canonical dot, without grouping or coercion. */
export function parseQuestionPointsInput(
  text: string,
  locale: InterfaceLocale,
): QuestionPointsInput {
  const trimmed = text.trim();
  if (!trimmed) return { _tag: 'Unset' };
  const normalized = trimmed.replace(decimalSeparator(locale), '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
    return { _tag: 'Invalid' };
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? { _tag: 'Value', value } : { _tag: 'Invalid' };
}

/** Preserve full numeric precision; this is input spelling, not rounded display formatting. */
export function questionPointsInputText(
  value: number | undefined,
  locale: InterfaceLocale,
): string {
  return value === undefined ? '' : String(value).replace('.', decimalSeparator(locale));
}
