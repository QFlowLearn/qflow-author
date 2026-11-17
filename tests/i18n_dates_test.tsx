import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { formatCalendarDate, formatTimestamp } from '../lib/i18n/dates.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import LocalizedTimestamp from '../islands/LocalizedTimestamp.tsx';

testCase('timestamps use the selected language and zone without displaying the zone', () => {
  const midnight = new Date('2026-09-14T23:30:00Z');
  expect(formatTimestamp(midnight, 'sv-SE', 'Europe/Stockholm')).toContain('15 sep. 2026');
  expect(formatTimestamp(midnight, 'es-ES', 'Europe/Madrid')).toContain('15 sept 2026');
  expect(formatTimestamp(midnight, 'sv-SE', 'America/New_York')).toContain('14 sep. 2026');
  expect(formatTimestamp(new Date('2026-09-10T19:19:00Z'), 'en-US', 'America/New_York'))
    .toStrictEqual('Sep 10, 2026, 3:19 PM');
  for (const zone of ['Europe/Stockholm', 'Europe/Madrid']) {
    expect(formatTimestamp(new Date('2026-03-29T00:30:00Z'), 'sv-SE', zone)).toContain('01:30');
    expect(formatTimestamp(new Date('2026-03-29T01:30:00Z'), 'sv-SE', zone)).toContain('03:30');
    expect(formatTimestamp(new Date('2026-10-25T00:30:00Z'), 'sv-SE', zone)).toContain('02:30');
    expect(formatTimestamp(new Date('2026-10-25T01:30:00Z'), 'sv-SE', zone)).toContain('02:30');
  }
});

testCase('calendar dates preserve the date and reject invalid input', () => {
  expect(formatCalendarDate('2026-09-14', 'sv-SE', 'short')).toStrictEqual('2026-09-14');
  expect(formatCalendarDate('2026-09-14', 'es-ES', 'long')).toStrictEqual(
    '14 de septiembre de 2026',
  );
  expect(formatCalendarDate('2024-02-29', 'sv-SE', 'short')).toStrictEqual('2024-02-29');
  for (
    const invalid of ['2026-02-29', '2026-02-30', '2026-13-01', '14/9/2026', '2026-09-14T00:00:00Z']
  ) {
    expect(formatCalendarDate(invalid, 'sv-SE')).toStrictEqual(null);
  }
});

testCase('SSR preserves timestamp markup and translated word order', () => {
  const i18n = createI18n('sv-SE', { test: { reviewed: '{date}: granskad av {name}' } });
  const html = render(
    <p>
      {i18n.rich('reviewed', {
        date: <LocalizedTimestamp value='2026-09-14T23:30:00Z' locale='sv-SE' />,
        name: '<Reviewer>',
      })}
    </p>,
  );
  expect(html).toContain('<time datetime="2026-09-14T23:30:00.000Z"');
  expect(html).toContain('</time>: granskad av &lt;Reviewer>');
  expect(html.includes('(UTC)')).toStrictEqual(false);
  expect(html).toContain('14 sep. 2026');
});
