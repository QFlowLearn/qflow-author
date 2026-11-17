import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import EditorSettingsPage from '../lib/http/routes/settings_pages/editor.tsx';

for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
  testCase(`editor settings renders states for ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const off = render(
      <EditorSettingsPage
        i18n={i18n}
        data={{ _tag: 'Saved', choiceRichText: false, instructorDefaults: null }}
      />,
    );
    const on = render(
      <EditorSettingsPage
        i18n={i18n}
        data={{ _tag: 'Saved', choiceRichText: true, instructorDefaults: null, success: true }}
      />,
    );
    expect(off).toContain(i18n.t('settings.editor.title'));
    expect(off).toContain(i18n.t('settings.editor.subtitle'));
    expect(off).toContain(i18n.t('settings.editor.choiceRichText'));
    expect(off).toContain(i18n.t('settings.editor.choiceRichTextHelp'));
    expect(off).toContain('aria-describedby="choice-rich-text-help"');
    expect(off).toContain(i18n.t('settings.editor.save'));
    expect(off).toContain(i18n.t('settings.editor.back'));
    expect(on).toContain(i18n.t('settings.editor.saved'));
    if (!(on.includes('name="choiceRichText" checked'))) {
      expect.unreachable('Expected on.includes(\'name="choiceRichText" checked\')');
    }
    if (off.includes('name="choiceRichText" checked')) {
      expect.unreachable('Expected !off.includes(\'name="choiceRichText" checked\')');
    }
    if (off.includes('settings.editor.')) {
      expect.unreachable("Expected !off.includes('settings.editor.')");
    }
    expect(off).toContain(i18n.t('settings.editor.newQuestionPoints'));
    expect(off).toContain(i18n.t('settings.editor.pointsScope'));
    const rejected = render(
      <EditorSettingsPage
        i18n={i18n}
        data={{
          _tag: 'RejectedPoints',
          form: {
            choiceRichText: true,
            answerChoiceOrder: 'shuffled',
            pointText: '-<unfinished>',
          },
        }}
      />,
    );
    expect(rejected).toContain('value="-&lt;unfinished>"');
    expect(rejected).toContain('aria-invalid="true"');
    expect(rejected).toContain(i18n.t('settings.editor.pointsInvalid'));
    if (!(/<option\b(?=[^>]*selected)(?=[^>]*value="shuffled")[^>]*>/.test(rejected))) {
      expect.unreachable(
        'Expected /<option\\b(?=[^>]*selected)(?=[^>]*value="shuffled")[^>]*>/.test(rejected)',
      );
    }
    expect(rejected).toContain('name="choiceRichText" checked');
    if (rejected.includes(i18n.t('settings.editor.saved'))) {
      expect.unreachable("Expected !rejected.includes(i18n.t('settings.editor.saved'))");
    }
  });
}

testCase('editor settings copy differs between English and Spanish', () => {
  const en = createI18n('en-US', catalogForLocale('en-US'));
  const es = createI18n('es-ES', catalogForLocale('es-ES'));
  if (
    !(render(
      <EditorSettingsPage
        i18n={en}
        data={{ _tag: 'Saved', choiceRichText: false, instructorDefaults: null }}
      />,
    ) !==
      render(
        <EditorSettingsPage
          i18n={es}
          data={{ _tag: 'Saved', choiceRichText: false, instructorDefaults: null }}
        />,
      ))
  ) {
    expect.unreachable(
      "Expected render( <EditorSettingsPage i18n={en} data={{ _tag: 'Saved', choiceRichText: false, instru",
    );
  }
});
