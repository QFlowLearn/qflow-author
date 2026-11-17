import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { PositionObjectContent } from '../islands/drivers/position_object.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
const noop = () => {};
const common = {
  renderPromptField: (placeholder: string) => (
    <input aria-label='AUTHORED-PROMPT-Ω' placeholder={placeholder} />
  ),
  fieldHasIssue: () => false,
  fieldIssueText: () => undefined,
};

function renderPosition(locale: InterfaceLocale, populated: boolean) {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  const image = populated
    ? {
      source: 'https://example.test/stage?a=1&b=2',
      alt: '<script data-authored-stage>ALT-STAGE-Ω</script>',
      longDescription: 'AUTHORED-LONG-Ω',
      mimeType: 'image/svg+xml',
      width: 640,
      height: 360,
    }
    : { source: '', alt: '', longDescription: '', mimeType: '' };
  const objectImage = populated
    ? {
      source: 'https://example.test/object?x=1&y=2',
      alt: 'AUTHORED-OBJECT-ALT-漢字',
      mimeType: 'image/png',
      width: 32,
      height: 24,
    }
    : { source: '', alt: '', mimeType: '' };
  return renderToString(
    <I18nProvider payload={payload}>
      <PositionObjectContent
        {...common}
        responseIdentifier='RESPONSE_Ω'
        stageImage={image}
        objectImage={objectImage}
        centerPoint={populated ? '16 12' : ''}
        targets={populated ? [{ shape: 'circle', coords: '10,20,5', mappedValue: 1 }] : []}
        correctPoints={populated ? ['118 184', '240 130'] : []}
        setResponseIdentifier={noop}
        setStageImage={noop}
        setObjectImage={noop}
        setCenterPoint={noop}
        addTarget={noop}
        removeTarget={noop}
        updateTargetShape={noop}
        updateTargetCoords={noop}
        updateTargetMappedValue={noop}
        addCorrectPoint={noop}
        removeCorrectPoint={noop}
        updateCorrectPoint={noop}
      />
    </I18nProvider>,
  );
}

function assertSafe(html: string) {
  if (html.includes('driver.')) expect.unreachable("Expected !html.includes('driver.')");
  if (html.includes('editor.')) expect.unreachable("Expected !html.includes('editor.')");
  if (/\{(?:count|plural|select)(?:[,}])/.test(html)) {
    expect.unreachable('Expected !/\\{(?:count|plural|select)(?:[,}])/.test(html)');
  }
  if (html.includes('<script data-authored-stage>')) {
    expect.unreachable("Expected !html.includes('<script data-authored-stage>')");
  }
}

for (const locale of locales) {
  testCase(`position-object populated surface is localized (${locale})`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = renderPosition(locale, true);
    for (
      const key of [
        'positionObjectPrompt',
        'positionObjectStageImage',
        'positionObjectStageSource',
        'positionObjectStageAlt',
        'positionObjectStageAltPlaceholder',
        'positionObjectStageLongDescription',
        'positionObjectStageMimeType',
        'positionObjectStageWidth',
        'positionObjectStageHeight',
        'positionObjectObjectImage',
        'positionObjectObjectSource',
        'positionObjectObjectAlt',
        'positionObjectObjectAltPlaceholder',
        'positionObjectObjectMimeType',
        'positionObjectObjectWidth',
        'positionObjectObjectHeight',
        'positionObjectCenterPoint',
        'positionObjectTargets',
        'positionObjectAddTarget',
        'positionObjectCorrectPoints',
        'positionObjectAddCorrectPoint',
        'positionObjectRemovePoint',
      ] as const
    ) expect(html).toContain(i18n.t(`driver.${key}`, { number: 2 }));
    for (
      const key of ['shape', 'coordinates', 'remove', 'circle', 'rectangle', 'polygon'] as const
    ) {
      expect(html).toContain(i18n.t(`driver.${key}`));
    }
    expect(html).toContain(i18n.t('driver.positionObjectDefaultShape'));
    expect(html).toContain(i18n.t('driver.positionObjectCoords'));
    expect(html).toContain(i18n.t('driver.positionObjectMappedValue'));
    // ResponseIdentifierDisclosure intentionally has no SSR output; the browser
    // state assertions verify this generated identifier remains unchanged.
    expect(html).toContain('AUTHORED-LONG-Ω');
    expect(html).toContain('image/svg+xml');
    expect(html).toContain('image/png');
    for (
      const [value, label] of [
        ['circle', i18n.t('driver.circle')],
        ['rect', i18n.t('driver.rectangle')],
        ['poly', i18n.t('driver.polygon')],
        ['default', i18n.t('driver.positionObjectDefaultShape')],
      ]
    ) expect(html).toContain(`value="${value}">${label}</option>`);
    expect(html).toContain('10,20,5');
    expect(html).toContain('118 184');
    expect(html).toContain('240 130');
    expect(html).toContain('https://example.test/object?x=1&amp;y=2');
    expect(html).toContain('value="640"');
    expect(html).toContain('value="360"');
    expect(html).toContain('value="32"');
    expect(html).toContain('value="24"');
    expect(html).toContain('value="16 12"');
    expect(html).toContain('x,y,r or x1,y1,x2,y2');
    expect(html).toContain('https://example.test/stage?a=1&amp;b=2');
    expect(html).toContain('&lt;script data-authored-stage>ALT-STAGE-Ω&lt;/script>');
    expect(html).toContain('ALT-STAGE-Ω');
    expect(html).toContain('AUTHORED-OBJECT-ALT-漢字');
    assertSafe(html);
    if (locale === 'es-ES' || locale === 'es-419') {
      for (
        const phrase of [
          'Stage image',
          'Draggable object',
          'Stage image source',
          'Object image source',
          'Stage alt text',
          'Object alt text',
          'Describe the stage',
          'Describe the draggable object',
          'Stage long description',
          'Object MIME type',
          'Stage MIME type',
          'Stage width',
          'Stage height',
          'Object width',
          'Object height',
          'Object center point',
          'Target areas',
          'Add target',
          'Shape',
          'Coords',
          'Coordinates',
          'Mapped value',
          'Remove',
          '>Circle<',
          '>Rect<',
          '>Poly<',
          '>Default<',
          'Correct points',
          'Add point',
          'Add point values',
          'Remove point',
        ]
      ) if (html.includes(phrase)) expect.unreachable(`${locale} leaked ${phrase}`);
    }
  });

  testCase(`position-object empty surface is localized (${locale})`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = renderPosition(locale, false);
    expect(html).toContain(i18n.t('driver.positionObjectEmptyTargets'));
    expect(html).toContain(
      i18n.t('driver.positionObjectEmptyCorrectPoints').replaceAll('"', '&quot;'),
    );
    expect(html).toContain('x y');
    assertSafe(html);
  });
}
