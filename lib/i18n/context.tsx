import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { I18nPayload } from './payload.ts';
import { createI18n, type I18n } from './messages.ts';

/** Preact context carrying one island's immutable localization service. */
export const I18nContext = createContext<I18n | null>(null);

/** Provide request-generated i18n synchronously to SSR and hydration. */
export function I18nProvider(
  props: { readonly payload: I18nPayload; readonly children: preact.ComponentChildren },
) {
  return (
    <I18nContext.Provider value={createI18n(props.payload.locale, props.payload.namespaces)}>
      {props.children}
    </I18nContext.Provider>
  );
}

/** Read the current island localization service, failing outside a provider. */
export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('I18nProvider is required.');
  return value;
}
