import type { InterfaceLocale } from './locale.ts';

/** Display options for an instant; calendar dates use formatCalendarDate instead. */
export type TimestampOptions = Readonly<{
  dateStyle?: 'numeric' | 'full' | 'long' | 'medium' | 'short';
  showTime?: boolean;
}>;

/** Format an instant in an explicit zone. */
export function formatTimestamp(
  value: Date,
  locale: InterfaceLocale,
  timeZone: string,
  options: TimestampOptions = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    ...(options.dateStyle === 'numeric'
      ? { year: 'numeric', month: 'numeric', day: 'numeric' } as const
      : { dateStyle: options.dateStyle ?? 'medium' }),
    ...(options.showTime === false
      ? {}
      : options.dateStyle === 'numeric'
      ? { hour: 'numeric', minute: '2-digit' } as const
      : { timeStyle: 'short' }),
    timeZone,
  }).format(value);
}

/** Format a valid ISO calendar date without converting it to the viewer's time zone. */
export function formatCalendarDate(
  value: string,
  locale: InterfaceLocale,
  dateStyle: 'full' | 'long' | 'medium' | 'short' = 'medium',
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle, timeZone: 'UTC' }).format(date);
}
