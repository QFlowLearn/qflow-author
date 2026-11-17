import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import {
  buildRightRailControls,
  createRailDraft,
} from '../islands/drivers/right_rail/build_controls.tsx';
import { ExtendedTextSection, UploadSection } from '../islands/drivers/right_rail/sections.tsx';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
const itemLanguageMessages = {
  label: 'Item language',
  help: 'Enter a valid BCP 47 tag.',
  required: 'Item language is required.',
  invalid: 'Enter a valid BCP 47 language tag.',
};

for (const locale of locales) {
  testCase('extended text and upload right rails render localized UI in ' + locale, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const extendedDraft = createRailDraft('extended_text', {
      type: 'extended_text',
      itemLanguage: newAuthoringItemLanguage(),
      expectedLength: 200,
      expectedLines: 6,
      placeholderText: 'AUTHORED RESPONSE',
      patternMask: '^[A-Z]+$',
      patternMessage: 'AUTHORED ERROR',
      stringIdentifier: 'RESPONSE',
    });
    const uploadDraft = createRailDraft('upload', {
      type: 'upload',
      itemLanguage: newAuthoringItemLanguage(),
      uploadFileTypes: '.pdf, .xlsx',
    });
    const extended = buildRightRailControls(
      'extended_text',
      TYPE_DRIVERS.extended_text.capabilities,
      extendedDraft,
      () => {},
      {
        scoringTemplates: TYPE_DRIVERS.extended_text.scoringTemplates,
        itemLanguageMessages,
        t: i18n.t,
      },
    );
    const upload = buildRightRailControls(
      'upload',
      TYPE_DRIVERS.upload.capabilities,
      uploadDraft,
      () => {},
      { scoringTemplates: TYPE_DRIVERS.upload.scoringTemplates, itemLanguageMessages, t: i18n.t },
    );
    const html = render(
      <I18nProvider payload={payload}>
        <ExtendedTextSection controls={extended} />
        <UploadSection controls={upload} />
      </I18nProvider>,
    );
    expect(html).toContain('AUTHORED RESPONSE');
    expect(html).toContain('^[A-Z]+$');
    expect(html).toContain('.pdf, .xlsx');
    expect(html).toContain(i18n.t('driver.rightRail.responseBox'));
    expect(html).toContain(i18n.t('driver.rightRail.uploadConstraints'));
    expect(html).not.toMatch(/driver\.rightRail\./);
    if (locale.startsWith('es')) {
      if (html.includes('Response box')) {
        expect.unreachable("Expected !html.includes('Response box')");
      }
      if (html.includes('Upload constraints')) {
        expect.unreachable("Expected !html.includes('Upload constraints')");
      }
      if (html.includes('Expected length')) {
        expect.unreachable("Expected !html.includes('Expected length')");
      }
    }
  });
}
