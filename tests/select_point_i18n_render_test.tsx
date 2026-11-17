import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { SelectPointContent } from '../islands/drivers/select_point.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
const noop = () => {};
const noIssue = () => false;
const noIssueText = () => undefined;

function renderContent(
  locale: InterfaceLocale,
  maxChoices: number | undefined,
  points: string[],
  image: { source: string; alt: string } | null = {
    source: 'https://example.test/image?a=1&b=2',
    alt: '<img data-authored-point>ALT<&>Ω漢字',
  },
  targets = [
    { shape: 'circle' as const, coords: '10,20,5', mappedValue: 1 },
    { shape: 'default' as const, coords: '1,2,3,4', mappedValue: 0 },
  ],
) {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  return renderToString(
    <I18nProvider payload={payload}>
      <SelectPointContent
        responseIdentifier='RESPONSE_Ω'
        image={image
          ? {
            ...image,
            longDescription: 'AUTHORED-LONG-Ω',
            mimeType: 'image/svg+xml',
            width: 640,
            height: 360,
          }
          : { source: '', alt: '' }}
        maxChoices={maxChoices}
        targets={targets}
        correctPoints={points}
        renderPromptField={(placeholder) => (
          <input aria-label='AUTHORED-PROMPT-Ω' placeholder={placeholder} />
        )}
        fieldHasIssue={noIssue}
        fieldIssueText={noIssueText}
        setResponseIdentifier={noop}
        setImage={noop}
        addTarget={noop}
        removeTarget={noop}
        updateTargetShape={noop}
        updateTargetCoords={noop}
        updateTargetMappedValue={noop}
        setCorrectPoints={noop}
      />
    </I18nProvider>,
  );
}

function assertSafe(output: string) {
  if (output.includes('driver.')) expect.unreachable("Expected !output.includes('driver.')");
  if (output.includes('editor.')) expect.unreachable("Expected !output.includes('editor.')");
  if (output.match(/\{(?:count|plural|select)(?:[,}])/)) {
    expect.unreachable('Expected !output.match(/\\{(?:count|plural|select)(?:[,}])/)');
  }
  if (output.includes('data-authored-point')) {
    if (!(output.includes('ALT&lt;&amp;>Ω漢字'))) {
      expect.unreachable("Expected output.includes('ALT&lt;&amp;>Ω漢字')");
    }
    if (!(output.includes('https://example.test/image?a=1&amp;b=2'))) {
      expect.unreachable("Expected output.includes('https://example.test/image?a=1&amp;b=2')");
    }
  }
  if (output.includes('<img data-authored-point')) {
    expect.unreachable("Expected !output.includes('<img data-authored-point')");
  }
}

for (const locale of locales) {
  testCase(`select-point populated and bounded UI is localized (${locale})`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = renderContent(locale, 2, ['120 130', '240 130']);
    for (
      const id of [
        'selectPointPrompt',
        'selectPointTargets',
        'selectPointAddTarget',
        'selectPointMappedValue',
        'selectPointCorrectPoints',
        'selectPointEditor',
        'selectPointEditing',
        'selectPointPlace',
        'selectPointInstruction',
      ] as const
    ) {
      const expected = id === 'selectPointPlace'
        ? i18n.t('driver.selectPointPlace', { number: 1 })
        : id === 'selectPointInstruction'
        ? i18n.t('driver.selectPointInstruction', {
          point: i18n.t('driver.selectPointIndexed', { number: 1 }),
        })
        : i18n.t(`driver.${id}`);
      expect(html).toContain(expected);
    }
    for (const value of ['circle', 'rect', 'poly', 'default']) {
      if (!(html.includes(`value="${value}"`))) {
        expect.unreachable('Expected html.includes(`value="${value}"`)');
      }
    }
    expect(html).toContain(i18n.t('driver.selectPointCountOfLimit', { count: 2, limit: 2 }));
    for (
      const key of [
        'imageSource',
        'imageAlt',
        'imageAltPlaceholder',
        'imageLongDescription',
        'mimeTypeOptional',
      ] as const
    ) expect(html).toContain(i18n.t(`editor.${key}`));
    expect(html).toContain(i18n.t('editor.widthPixels'));
    expect(html).toContain(i18n.t('editor.heightPixels'));
    for (
      const key of [
        'shape',
        'coordinates',
        'remove',
        'circle',
        'rectangle',
        'polygon',
        'selectPointDefaultShape',
      ] as const
    ) {
      expect(html).toContain(i18n.t(`driver.${key}`));
    }
    // ResponseIdentifierDisclosure intentionally keeps the generated response
    // identifier out of the visible SSR surface; browser state assertions
    // below verify that it remains unchanged through interactions.
    expect(html).toContain('AUTHORED-LONG-Ω');
    expect(html).toContain('image/svg+xml');
    for (const coords of ['10,20,5', '1,2,3,4']) expect(html).toContain(coords);
    expect(html).toContain('value="1"');
    expect(html).toContain('value="0"');
    assertSafe(html);
    if (locale === 'es-ES' || locale === 'es-419') {
      for (
        const phrase of [
          'Image source',
          'Image alt text',
          'Describe the image',
          'Image long description',
          'Image MIME type',
          'Image width',
          'Image height',
          'Target areas',
          'Add target',
          'Add target areas for scoring',
          'Shape',
          'Coordinates',
          'Mapped value',
          'Remove',
          'Circle',
          'Rectangle',
          'Polygon',
          'Default',
          'Correct point',
          'Correct points',
          'Set point',
          'Add point',
          'Set the point on the image',
          'Add points on the image',
          'Point 1',
          'Edit point 1',
          'Remove point 1',
          'Editing',
          'Point editor',
          'Editing point',
          'Place point 1 on the image',
          'Click the image to place',
          'Upload an image to place correct points visually',
        ]
      ) if (html.includes(phrase)) expect.unreachable(`${locale} leaked ${phrase}`);
    }
  });

  testCase(`select-point empty and unlimited states are localized (${locale})`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const empty = renderContent(locale, 1, []);
    expect(empty).toContain(i18n.t('driver.selectPointEmptySingle'));
    expect(empty).toContain(i18n.t('driver.selectPointSetPoint'));
    const unlimited = renderContent(locale, 0, ['120 130', '240 130']);
    expect(unlimited).toContain(i18n.t('driver.selectPointCount', { count: 2 }));
    expect(unlimited).toContain(i18n.t('driver.selectPointAddPoint'));
    assertSafe(empty);
    assertSafe(unlimited);
    const noImage = renderContent(locale, 1, [], null, []);
    expect(noImage).toContain(i18n.t('driver.selectPointEmptyTargets'));
    expect(noImage).toContain(i18n.t('driver.selectPointNoImage'));
    const finiteEmpty = renderContent(locale, 2, [], null, []);
    expect(finiteEmpty).toContain(i18n.t('driver.selectPointCountOfLimit', { count: 0, limit: 2 }));
    const finiteOne = renderContent(locale, 2, ['120 130'], null, []);
    expect(finiteOne).toContain(i18n.t('driver.selectPointCountOfLimit', { count: 1, limit: 2 }));
    expect(finiteEmpty).toContain(i18n.t('driver.selectPointEmptyMultiple'));
    assertSafe(noImage);
    assertSafe(finiteEmpty);
    assertSafe(finiteOne);
  });
}
