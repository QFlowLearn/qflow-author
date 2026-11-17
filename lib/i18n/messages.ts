import type { ComponentChildren, VNode } from 'preact';
import { createIntl, createIntlCache, type IntlShape } from '@formatjs/intl';
import type { InterfaceLocale } from './locale.ts';
import { NAMED_FORMATS } from './formats.ts';

/** Catalog entries grouped by namespace. Values are ICU message strings. */
export type MessageCatalog = Readonly<Record<string, Readonly<Record<string, string>>>>;
/** Values accepted by ICU interpolation. */
export type MessageValues = Readonly<Record<string, string | number | Date | boolean>>;
/** Request-scoped message and formatting API. */
export type I18n = Readonly<{
  locale: InterfaceLocale;
  t(id: string, values?: MessageValues): string;
  rich(
    id: string,
    values: Readonly<Record<string, string | number | Date | boolean | VNode>>,
  ): ComponentChildren;
  formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  formatDateNamed(value: Date | number): string;
  formatTime(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  formatTimeNamed(value: Date | number): string;
  formatNumberNamed(value: number): string;
  formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string;
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  formatPercent(value: number): string;
  formatList(value: ReadonlyArray<string>): string;
  collator: Intl.Collator;
}>;

/** Create a fail-fast, request-scoped ICU message service from complete namespaces. */
export function createI18n(locale: InterfaceLocale, catalog: MessageCatalog): I18n {
  const messages: Record<string, string> = {};
  for (const entries of Object.values(catalog)) {
    for (const [key, message] of Object.entries(entries)) {
      if (messages[key] !== undefined) throw new Error(`Duplicate i18n message: ${key}`);
      messages[key] = message;
    }
  }
  const intl: IntlShape<VNode> = createIntl<VNode>({
    locale,
    messages,
    timeZone: 'UTC',
    formats: {
      date: { date: NAMED_FORMATS.date },
      time: { time: NAMED_FORMATS.time },
      number: { integer: NAMED_FORMATS.integer },
    },
    onError(error) {
      throw error;
    },
  }, createIntlCache());
  return {
    locale,
    t(id, values) {
      const message = messages[id];
      if (message === undefined) throw new Error(`Missing i18n message: ${id}`);
      return intl.formatMessage({ id, defaultMessage: message }, values);
    },
    rich(id, values) {
      const message = messages[id];
      if (message === undefined) throw new Error(`Missing i18n message: ${id}`);
      return intl.formatMessage<VNode, VNode>({ id, defaultMessage: message }, values);
    },
    formatDate: (value, options) =>
      new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(value),
    formatDateNamed: (value) => intl.formatDate(value, { format: 'date' }),
    formatTime: (value, options) =>
      new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(value),
    formatTimeNamed: (value) => intl.formatTime(value, { format: 'time' }),
    formatRelativeTime: (value, unit) =>
      new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, unit),
    formatNumber: (value, options) => new Intl.NumberFormat(locale, options).format(value),
    formatNumberNamed: (value) => intl.formatNumber(value, { format: 'integer' }),
    formatPercent: (value) => new Intl.NumberFormat(locale, { style: 'percent' }).format(value),
    formatList: (value) => new Intl.ListFormat(locale).format(value),
    collator: new Intl.Collator(locale),
  };
}
