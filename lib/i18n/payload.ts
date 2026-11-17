import type { InterfaceLocale } from './locale.ts';
import type { MessageCatalog } from './messages.ts';

/** JSON-serializable island payload containing only requested namespaces. */
export type I18nPayload = Readonly<{ locale: InterfaceLocale; namespaces: MessageCatalog }>;

/** Build an immutable, serializable payload for one island's namespaces. */
export function createI18nPayload(
  locale: InterfaceLocale,
  catalog: MessageCatalog,
  namespaces: ReadonlyArray<string>,
): I18nPayload {
  const selected: Record<string, Readonly<Record<string, string>>> = {};
  for (const namespace of namespaces) {
    const messages = catalog[namespace];
    if (!messages) throw new Error(`Missing i18n namespace: ${namespace}`);
    selected[namespace] = messages;
  }
  return { locale, namespaces: selected };
}
