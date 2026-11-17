import { useEffect, useState } from 'preact/hooks';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import { formatTimestamp, type TimestampOptions } from '../lib/i18n/dates.ts';

/** Display an instant in the browser's zone after hydration. */
export default function LocalizedTimestamp(
  props: TimestampOptions & Readonly<{ value: string; locale: InterfaceLocale }>,
) {
  // Keep the initial browser render identical to SSR; hydration switches to the browser's zone.
  const [timeZone, setTimeZone] = useState('UTC');
  useEffect(() => {
    const update = () => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    update();
    globalThis.addEventListener('focus', update);
    globalThis.addEventListener('pageshow', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      globalThis.removeEventListener('focus', update);
      globalThis.removeEventListener('pageshow', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const date = new Date(props.value);
  return (
    <time dateTime={date.toISOString()} title={date.toISOString()}>
      {formatTimestamp(date, props.locale, timeZone, props)}
    </time>
  );
}
