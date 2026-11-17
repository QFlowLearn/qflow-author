import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { parseInterfaceLocale } from '../lib/i18n/locale.ts';
import { parseItemLanguage } from '../lib/types/item_language.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import ItemEditorProvider from '../islands/item_editor/ItemEditorProvider.tsx';
import ItemEditorInspector from '../islands/item_editor/ItemEditorInspector.tsx';
import { createGlossaryCatalog } from '../islands/CatalogAuthoring.tsx';
import CatalogAuthoring from '../islands/CatalogAuthoring.tsx';
import { LanguageField } from '../islands/CatalogAuthoring.tsx';
import RichTextEditor from '../islands/RichTextEditor.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { PREDEFINED_CATALOG_SUPPORTS } from '../lib/catalog_metadata.ts';
import { testAssessmentBlueprint } from './assessment_blueprint_fixture.ts';
import { FieldIssueMessage } from '../components/ui/Input.tsx';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;

for (const locale of locales) {
  testCase(`inspector and catalog authoring render in ${locale}`, () => {
    const parsedLocale = parseInterfaceLocale(locale);
    if (!parsedLocale) throw new Error(`Unsupported test locale: ${locale}`);
    const payload = createI18nPayload(
      parsedLocale,
      catalogForLocale(parsedLocale),
      ['authoring'],
    );
    const initialDraft = {
      ...TYPE_DRIVERS.single_select.defaults(),
      type: 'single_select' as const,
      itemLanguage: parseItemLanguage('fr-CA'),
      title: 'AUTHORED-TITLE-SENTINEL',
      bodyHtml: '<p>Prompt</p><img src="x">',
      standards: [{
        code: 'STD-CODE',
        providerId: 'STD-PROVIDER',
        label: 'STD-LABEL',
        standardId: 'STD-GUID',
        uri: 'STD-URI',
      }],
      catalogs: [{
        id: 'AUTHORED-CATALOG-ID',
        cards: [{
          support: { kind: 'custom' as const, value: 'AUTHORED-SUPPORT' },
          entries: [{ contentHtml: '<p>AUTHORED-CATALOG-CONTENT</p>' }],
        }],
      }],
    };
    const html = renderToString(
      <I18nProvider payload={payload}>
        <ItemEditorProvider
          pointEditingAuthority={{ _tag: 'Generated' }}
          persistence={{
            _tag: 'Assessment',
            save: () => Promise.resolve({ itemId: 'id', rev: 1, identifier: 'id' }),
          }}
          choiceRichText={false}
          payload={payload}
          playerCatalog={playerMessageCatalogForLocale(parsedLocale)}
          initialDraft={initialDraft}
          blueprint={testAssessmentBlueprint([{
            id: 'target-1',
            questionType: 'single_select',
            count: 1,
          }])}
          initialBlueprintTargetId='target-1'
          aiReviewSuggestions={[{
            source: 'ai',
            category: 'ambiguity',
            code: 'AI-SENTINEL-CODE',
            message: 'EXTERNAL-AI-SENTINEL',
          }]}
        >
          <ItemEditorInspector />
        </ItemEditorProvider>
      </I18nProvider>,
    );
    const i18n = createI18n(parsedLocale, payload.namespaces);
    expect(html).toContain(i18n.t('inspector.details'));
    expect(html).toContain(i18n.t('catalog.accessibilityCatalogs'));
    expect(html).toContain('AUTHORED-TITLE-SENTINEL');
    expect(html).toContain('AUTHORED-CATALOG-ID');
    expect(html).toContain('AUTHORED-CATALOG-CONTENT');
    expect(html).toContain('AUTHORED-SUPPORT');
    expect(html).toContain('fr-CA');
    expect(html).toContain('STD-CODE');
    expect(html).toContain('STD-PROVIDER');
    expect(html).toContain('STD-LABEL');
    expect(html).toContain('STD-GUID');
    expect(html).toContain('STD-URI');
    expect(html).toContain('Test outcome');
    expect(html).toContain(i18n.t('inspector.cognitive.understand'));
    expect(html).toContain(i18n.t('inspector.difficulty.medium'));
    expect(html).toContain('EXTERNAL-AI-SENTINEL');
    expect(html).toContain(i18n.t('inspector.aiSuggestion'));
    expect(html).toContain('missing alt text');
    expect(html).toContain(i18n.t('inspector.severityWarning'));
    expect(html).toContain('MISSING_ALT_TEXT');
    if (locale.startsWith('es-')) {
      expect(html).not.toMatch(
        /Details and standards|Accessibility catalogs|Add glossary definition/,
      );
    }
    if (!(createGlossaryCatalog('new-glossary').cards[0].entries?.[0].contentHtml === '<p></p>')) {
      expect.unreachable(
        "Expected createGlossaryCatalog('new-glossary').cards[0].entries?.[0].contentHtml === '<p></p>'",
      );
    }
    expect(html).not.toMatch(/inspector\.|catalog\.|stylesheet\./);
  });
}

for (const locale of locales) {
  testCase(`title issue relationship in ${locale}`, () => {
    const parsedLocale = parseInterfaceLocale(locale);
    if (!parsedLocale) throw new Error(`Unsupported test locale: ${locale}`);
    const payload = createI18nPayload(parsedLocale, catalogForLocale(parsedLocale), ['authoring']);
    const i18n = createI18n(parsedLocale, payload.namespaces);
    const html = renderToString(
      <I18nProvider payload={payload}>
        <label>
          Title<input aria-describedby='item-title-issue' />
          <FieldIssueMessage id='item-title-issue' message={i18n.t('inspector.titleHelp')} />
        </label>
      </I18nProvider>,
    );
    expect(html).toContain('aria-describedby="item-title-issue"');
    expect(html).toContain('id="item-title-issue"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(i18n.t('inspector.titleHelp'));
  });
}

for (const locale of locales) {
  testCase(`catalog empty and invalid language semantics in ${locale}`, () => {
    const parsedLocale = parseInterfaceLocale(locale);
    if (!parsedLocale) throw new Error(`Unsupported test locale: ${locale}`);
    const payload = createI18nPayload(parsedLocale, catalogForLocale(parsedLocale), ['authoring']);
    const html = renderToString(
      <I18nProvider payload={payload}>
        <CatalogAuthoring
          catalogs={[]}
          stylesheets={[]}
          onCatalogsChange={() => {}}
          onStylesheetsChange={() => {}}
        />
      </I18nProvider>,
    );
    const i18n = createI18n(parsedLocale, payload.namespaces);
    expect(html).toContain(i18n.t('catalog.accessibilityCatalogs'));
    expect(html).toContain(i18n.t('catalog.description'));
    expect(html).toContain(i18n.t('catalog.empty'));
    expect(html).toContain(i18n.t('stylesheet.heading'));
    expect(html).toContain(i18n.t('stylesheet.description'));
    expect(html).toContain(i18n.t('stylesheet.add'));
    expect(html).not.toMatch(/catalog\.|stylesheet\./);
    if (locale.startsWith('es-')) {
      expect(html).not.toMatch(/Accessibility catalogs|No catalogs yet|Item stylesheets/);
    }
    const invalid = renderToString(
      <I18nProvider payload={payload}>
        <LanguageField
          id='invalid-language'
          label={i18n.t('catalog.cardLanguage')}
          value='not_a_tag'
          onChange={() => {}}
        />
      </I18nProvider>,
    );
    expect(invalid).toContain('aria-invalid="true"');
    expect(invalid).toContain('aria-describedby="invalid-language-error"');
    expect(invalid).toContain('id="invalid-language-error"');
    expect(invalid).toContain('role="alert"');
    expect(invalid).toContain('aria-live="polite"');
    expect(invalid).toContain(i18n.t('catalog.invalidLanguage'));
  });
}

for (const locale of locales) {
  testCase(`rich text fallback sanitizes content in ${locale}`, () => {
    const parsedLocale = parseInterfaceLocale(locale);
    if (!parsedLocale) throw new Error(`Unsupported test locale: ${locale}`);
    const payload = createI18nPayload(parsedLocale, catalogForLocale(parsedLocale), ['authoring']);
    const html = renderToString(
      <I18nProvider payload={payload}>
        <RichTextEditor
          valueHtml='<p>AUTHORED-RICH-CONTENT</p><script>secret</script><img src="x" onerror="secret" />'
          onChangeHtml={() => {}}
          contentScope='body'
        />
      </I18nProvider>,
    );
    const i18n = createI18n(parsedLocale, payload.namespaces);
    const status = `<span role="status" aria-live="polite">${
      i18n.t('editor.loadingRichText')
    }</span>`;
    const content = `<div aria-label="${i18n.t('editor.currentContent')}">`;
    expect(html).toContain(status);
    expect(html).toContain(content);
    if (!(html.indexOf(status) < html.indexOf(content))) {
      expect.unreachable('Expected html.indexOf(status) < html.indexOf(content)');
    }
    expect(html).toContain('AUTHORED-RICH-CONTENT');
    expect(html).toContain('&lt;script&gt;secret&lt;/script&gt;');
    if (!(!html.includes('<script') && !html.includes('onerror'))) {
      expect.unreachable("Expected !html.includes('<script') && !html.includes('onerror')");
    }
    expect(html).not.toMatch(/editor\./);
  });
}

for (const locale of locales) {
  testCase(`catalog authoring preserves rendered content in ${locale}`, () => {
    const parsedLocale = parseInterfaceLocale(locale);
    if (!parsedLocale) throw new Error(`Unsupported test locale: ${locale}`);
    const payload = createI18nPayload(parsedLocale, catalogForLocale(parsedLocale), ['authoring']);
    const catalog = [{
      id: 'AUTHORED-CATALOG-ID',
      cards: [{
        support: { kind: 'predefined' as const, value: 'glossary-on-screen' },
        language: 'fr-CA',
        entries: [{
          language: 'fr-CA',
          contentHtml: '<p>AUTHORED-CATALOG-CONTENT</p>',
          files: [{ href: '/pkg/audio.mp3', mimeType: 'audio/mpeg' }],
        }],
      }],
    }];
    const html = renderToString(
      <I18nProvider payload={payload}>
        <CatalogAuthoring
          catalogs={catalog}
          stylesheets={[{ href: 'styles/item.css', type: 'text/css' }]}
          onCatalogsChange={() => {}}
          onStylesheetsChange={() => {}}
        />
      </I18nProvider>,
    );
    const i18n = createI18n(parsedLocale, payload.namespaces);
    expect(html).toContain('AUTHORED-CATALOG-CONTENT');
    expect(html).toContain('fr-CA');
    expect(html).toContain('/pkg/audio.mp3');
    expect(html).toContain('styles/item.css');
    expect(html).toContain('placeholder="/uploads/… · package/path"');
    expect(html).toContain('placeholder="/uploads/… · styles/item.css"');
    expect(html).not.toMatch(/or package path|or styles\/item\.css/);
    expect(payload.namespaces.authoring !== undefined).toStrictEqual(true);
    expect(html).toContain(i18n.t('catalog.removeCatalogNamed', { name: 'AUTHORED-CATALOG-ID' }));
    expect(html).toContain(i18n.t('catalog.removeCardNamed', { name: 'glossary-on-screen' }));
    expect(html).toContain(i18n.t('catalog.removeEntryNamed', { name: 'fr-CA' }));
    expect(html).toContain(i18n.t('catalog.removeFileNamed', { name: '/pkg/audio.mp3' }));
    expect(html).toContain(i18n.t('stylesheet.removeNamed', { name: 'styles/item.css' }));
    for (const support of PREDEFINED_CATALOG_SUPPORTS) {
      expect(html).toContain(`value="${support}"`);
      expect(html).toContain(i18n.t(`catalog.support.${support}`));
    }
  });
}
