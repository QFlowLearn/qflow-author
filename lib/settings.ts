type UserTheme = 'dark' | 'wireframe' | 'system';
import { type InterfaceLocale, parseInterfaceLocale } from './i18n/locale.ts';

/** Persisted user preferences. */
export type UserSettings = {
  readonly theme: UserTheme;
  readonly choiceRichText: boolean;
  readonly interfaceLocale: InterfaceLocale;
};

/** Non-locale preferences used when parsing a complete persisted document. */
export const defaultSettings = {
  theme: 'system',
  choiceRichText: false,
} as const;

/** Create complete initial settings from a boundary-parsed locale. */
export function createInitialUserSettings(interfaceLocale: InterfaceLocale): UserSettings {
  return { ...defaultSettings, interfaceLocale };
}

type UserSettingsPatch = {
  readonly theme?: UserTheme;
  readonly choiceRichText?: boolean;
  readonly interfaceLocale?: InterfaceLocale;
};

/** Parses one current application theme without compatibility aliases. */
export function parseUserTheme(value: unknown): UserTheme | null {
  if (value === 'dark' || value === 'wireframe' || value === 'system') return value;
  return null;
}

/** Parses a strict partial user-settings object. */
export function parseUserSettingsPatch(value: unknown): UserSettingsPatch | null {
  if (!isSettingsRecord(value)) return null;
  const record = value;
  if (
    Object.keys(record).some((key) => !['theme', 'choiceRichText', 'interfaceLocale'].includes(key))
  ) return null;

  let theme: UserTheme | undefined;
  if (record.theme !== undefined) {
    const parsedTheme = parseUserTheme(record.theme);
    if (parsedTheme === null) return null;
    theme = parsedTheme;
  }

  let choiceRichText: boolean | undefined;
  if (record.choiceRichText !== undefined) {
    if (typeof record.choiceRichText !== 'boolean') return null;
    choiceRichText = record.choiceRichText;
  }

  let interfaceLocale: InterfaceLocale | undefined;
  if (record.interfaceLocale !== undefined) {
    const parsedLocale = parseInterfaceLocale(record.interfaceLocale);
    if (parsedLocale === null) return null;
    interfaceLocale = parsedLocale;
  }

  return {
    ...(theme === undefined ? {} : { theme }),
    ...(choiceRichText === undefined ? {} : { choiceRichText }),
    ...(interfaceLocale === undefined ? {} : { interfaceLocale }),
  };
}

/** Complete HTTP settings fail through a typed result; persisted settings retain their storage contract. */
export function parseUserSettings(value: unknown, mode: 'complete'): UserSettings | null;
export function parseUserSettings(value: unknown): UserSettings;
export function parseUserSettings(value: unknown, mode?: 'complete'): UserSettings | null {
  const patch = parseUserSettingsPatch(value);
  if (
    !patch || patch.interfaceLocale === undefined ||
    (mode === 'complete' && (patch.theme === undefined || patch.choiceRichText === undefined))
  ) {
    if (mode === 'complete') return null;
    throw new Error('Stored user settings are invalid.');
  }
  return { ...defaultSettings, ...patch, interfaceLocale: patch.interfaceLocale };
}

function isSettingsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
