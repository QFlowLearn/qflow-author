import LocalizedTimestamp from '../../islands/LocalizedTimestamp.tsx';
import { formatCalendarDate } from '../../lib/i18n/dates.ts';
import type { InterfaceLocale } from '../../lib/i18n/locale.ts';
import { createI18n } from '../../lib/i18n/messages.ts';

/** Exercise server and island timestamp rendering through the same component tree. */
export function TimestampFixture({ locale }: { readonly locale: InterfaceLocale }) {
  const i18n = createI18n(locale, { test: { event: '{name}: {date}' } });
  return (
    <div>
      <p id='midnight'>
        <LocalizedTimestamp value='2026-09-14T23:30:00Z' locale={locale} />
      </p>
      <p id='spring-before'>
        <LocalizedTimestamp value='2026-03-29T00:30:00Z' locale={locale} />
      </p>
      <p id='spring-after'>
        <LocalizedTimestamp value='2026-03-29T01:30:00Z' locale={locale} />
      </p>
      <p id='rich'>
        {i18n.rich('event', {
          name: '<Review>',
          date: <LocalizedTimestamp value='2026-09-14T23:30:00Z' locale={locale} />,
        })}
      </p>
      <p id='calendar'>{formatCalendarDate('2026-09-14', locale, 'long')}</p>
      <input aria-label='Unsaved note' />
    </div>
  );
}
