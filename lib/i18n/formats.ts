/** Named formatting options shared by localized QFlow surfaces. */
export const NAMED_FORMATS = {
  date: { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' },
  time: { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' },
  integer: { maximumFractionDigits: 0 },
} as const satisfies Readonly<
  Record<string, Intl.DateTimeFormatOptions | Intl.NumberFormatOptions>
>;
