/** Supported interface locales, in stable display order. */
export const INTERFACE_LOCALES = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const;
/** Closed domain of interface locales supported by QFlow. */
export type InterfaceLocale = (typeof INTERFACE_LOCALES)[number];
/** Metadata used to render the document and language picker. */
export type LocaleMetadata = Readonly<
  { locale: InterfaceLocale; lang: string; dir: 'ltr'; beta: boolean }
>;

const METADATA: Readonly<Record<InterfaceLocale, LocaleMetadata>> = {
  'en-US': { locale: 'en-US', lang: 'en-US', dir: 'ltr', beta: false },
  'en-GB': { locale: 'en-GB', lang: 'en-GB', dir: 'ltr', beta: false },
  'es-ES': { locale: 'es-ES', lang: 'es-ES', dir: 'ltr', beta: true },
  'sv-SE': { locale: 'sv-SE', lang: 'sv-SE', dir: 'ltr', beta: true },
  'es-419': { locale: 'es-419', lang: 'es-419', dir: 'ltr', beta: true },
};

/** Parse an untrusted value at an interface-locale boundary. */
export function parseInterfaceLocale(value: unknown): InterfaceLocale | null {
  return typeof value === 'string' && isInterfaceLocale(value) ? value : null;
}

/** Return immutable display metadata for a supported interface locale. */
export function localeMetadata(locale: InterfaceLocale): LocaleMetadata {
  return METADATA[locale];
}

/** Parse the qflow-locale cookie value from a Cookie header. */
export function parseLocaleCookie(cookieHeader: string | null): InterfaceLocale | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== 'qflow-locale' || rest.length === 0) continue;
    try {
      return parseInterfaceLocale(decodeURIComponent(rest.join('=')));
    } catch (_error: unknown) {
      return null;
    }
  }
  return null;
}

/** Select the first supported locale from an Accept-Language header. */
export function matchAcceptLanguage(header: string | null): InterfaceLocale {
  if (!header) return 'en-US';
  const choices = header.split(',').flatMap((raw, index) => {
    const [tagPart, ...params] = raw.trim().split(';');
    const tag = tagPart?.trim();
    if (!tag || !/^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/.test(tag)) return [];
    let quality = 1;
    for (const param of params) {
      const [key, value] = param.trim().split('=');
      if (key?.toLowerCase() === 'q') {
        if (!value || !/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value)) return [];
        quality = Number(value);
      }
    }
    return [{ tag: tag.toLowerCase(), quality, index }];
  }).filter((choice) => choice.quality > 0).sort((a, b) =>
    b.quality - a.quality || a.index - b.index
  );
  for (const choice of choices) {
    if (choice.tag === '*') continue;
    let parsed: Intl.Locale;
    try {
      parsed = new Intl.Locale(choice.tag);
    } catch (_error: unknown) {
      continue;
    }
    const language = parsed.language;
    // English is intentionally narrow: only the exact supported en-GB tag
    // selects the UK catalogue. Script/private/other-region variants must not
    // accidentally inherit UK wording merely because Intl.Locale exposes GB.
    if (language === 'en') return choice.tag === 'en-gb' ? 'en-GB' : 'en-US';
    if (language === 'sv') return 'sv-SE';
    if (language === 'es') {
      if (!parsed.region || parsed.region === 'ES') return 'es-ES';
      return 'es-419';
    }
  }
  return 'en-US';
}

/** Resolve one request locale with account preference taking precedence over cookie/browser. */
export function resolveInterfaceLocale(
  persisted: InterfaceLocale | null,
  cookieHeader: string | null,
  acceptLanguage: string | null,
): InterfaceLocale {
  return persisted ?? parseLocaleCookie(cookieHeader) ?? matchAcceptLanguage(acceptLanguage);
}

/** Build the signed-out locale cookie with the application's cookie policy. */
export function buildLocaleCookie(url: URL, locale: InterfaceLocale): string {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `qflow-locale=${
    encodeURIComponent(locale)
  }; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`;
}

function isInterfaceLocale(value: string): value is InterfaceLocale {
  return (INTERFACE_LOCALES as readonly string[]).includes(value);
}
