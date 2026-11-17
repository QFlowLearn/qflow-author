import { expect, test as testCase } from 'vitest';

import { parseUserSettings, parseUserSettingsPatch, parseUserTheme } from '../lib/settings.ts';

testCase('user settings accept only current themes and known preference fields', () => {
  expect(parseUserTheme('dark')).toStrictEqual('dark');
  expect(parseUserTheme('wireframe')).toStrictEqual('wireframe');
  expect(parseUserTheme('system')).toStrictEqual('system');
  expect(parseUserTheme('light')).toStrictEqual(null);

  expect(parseUserSettingsPatch({ theme: 'dark' })).toStrictEqual({ theme: 'dark' });
  expect(parseUserSettingsPatch({ choiceRichText: true })).toStrictEqual({ choiceRichText: true });
  expect(parseUserSettingsPatch({ theme: 'light' })).toStrictEqual(null);
  expect(parseUserSettingsPatch({ theme: 'dark', ignored: true })).toStrictEqual(null);
});

testCase('persisted settings require locale but retain preference defaults', () => {
  expect(parseUserSettings({ interfaceLocale: 'en-US' })).toStrictEqual({
    theme: 'system',
    choiceRichText: false,
    interfaceLocale: 'en-US' as const,
  });
  expect(parseUserSettings({ theme: 'wireframe', choiceRichText: true, interfaceLocale: 'es-419' }))
    .toStrictEqual({
      theme: 'wireframe',
      choiceRichText: true,
      interfaceLocale: 'es-419',
    });
  expect(() => parseUserSettings({ theme: 'light' })).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error && caught.message.includes('Stored user settings are invalid.')
    ),
  );
  expect(() => parseUserSettings({ theme: 'system' })).toThrowError(Error);
  expect(() => parseUserSettings({ interfaceLocale: 'fr-FR' })).toThrowError(Error);
});
