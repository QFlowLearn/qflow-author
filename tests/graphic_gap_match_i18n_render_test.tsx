import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { GraphicGapMatchContent } from '../islands/drivers/graphic_gap_match.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n, type I18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
const noop = () => {};
const oldEnglish = [
  'Background image',
  'Background alt text',
  'Choices (draggables)',
  'Add choice',
  'Choice text',
  'Image source',
  'Image alt text',
  'Match max',
  'Advanced',
  'Choice identifier',
  'HTML (optional)',
  'Fixed',
  'Targets (drop zones)',
  'Add target',
  'Shape',
  'Coords',
  'Correct choice',
  'Select target',
  '>Edit<',
  '>Remove<',
  'Target editor',
  'Editing target',
  'Set a background image to draw targets.',
];
const assertNoEnglish = (html: string) =>
  oldEnglish.forEach((phrase) => {
    if (html.includes(phrase)) expect.unreachable('Expected !html.includes(phrase)');
  });
const image = {
  source: 'https://example.test/bg.png',
  alt: 'AUTHORED-ALT',
  longDescription: 'AUTHORED-LONG',
  mimeType: 'image/png',
  width: 640,
  height: 480,
};
function view(locale: InterfaceLocale, choices = true, targets = true, hasBackground = true) {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  return renderToString(
    <I18nProvider payload={payload}>
      <GraphicGapMatchContent
        graphicBackground={{ ...image, source: hasBackground ? image.source : '' }}
        graphicResponseId='RESPONSE_Ω'
        graphicChoices={choices
          ? [{
            id: 'A',
            kind: 'text',
            text: 'AUTHORED-TEXT',
            html: '<em>AUTHORED-HTML</em>',
            matchMax: 0,
            fixed: true,
          }, {
            id: 'IMG',
            kind: 'image',
            imgSrc: 'https://example.test/c.png',
            imgAlt: 'CHOICE-ALT',
            imgType: 'image/png',
            matchMax: 2,
          }]
          : []}
        graphicTargets={targets
          ? [
            { id: 'T1', shape: 'circle', coords: '10,20,30', matchMax: 0 },
            { id: 'T2', shape: 'rect', coords: '40,50,60,70', matchMax: 2 },
          ]
          : []}
        graphicCorrectPairs={[{ targetId: 'T1', choiceId: 'A' }]}
        setGraphicBackground={noop}
        setGraphicResponseId={noop}
        addGraphicChoice={noop}
        removeGraphicChoice={noop}
        updateGraphicChoiceId={noop}
        updateGraphicChoiceKind={noop}
        updateGraphicChoiceText={noop}
        updateGraphicChoiceHtml={noop}
        updateGraphicChoiceImage={noop}
        updateGraphicChoiceMatchMax={noop}
        setGraphicChoiceFixed={noop}
        addGraphicTarget={noop}
        removeGraphicTarget={noop}
        updateGraphicTargetId={noop}
        updateGraphicTargetShape={noop}
        updateGraphicTargetCoords={noop}
        updateGraphicTargetMatchMax={noop}
        setGraphicCorrectPair={noop}
        renderPromptField={(placeholder) => <input placeholder={placeholder} />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
      />
    </I18nProvider>,
  );
}
const t = (i18n: I18n, key: string, values?: Record<string, string | number>) =>
  i18n.t(`driver.${key}`, values);
for (const locale of locales) {
  testCase(`graphic gap match localized surface (${locale})`, () => {
    const i18n = createI18n(
      locale,
      createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces,
    );
    const html = view(locale);
    for (
      const key of [
        'graphicGapMatchPrompt',
        'graphicGapMatchBackgroundSource',
        'graphicGapMatchBackgroundAlt',
        'graphicGapMatchBackgroundAltPlaceholder',
        'graphicGapMatchBackgroundLongDescription',
        'graphicGapMatchBackgroundMimeType',
        'graphicGapMatchChoices',
        'graphicGapMatchAddChoice',
        'graphicGapMatchChoice',
        'graphicGapMatchKind',
        'graphicGapMatchText',
        'graphicGapMatchImage',
        'graphicGapMatchTextPlaceholder',
        'graphicGapMatchChoiceImageSource',
        'graphicGapMatchChoiceImageAlt',
        'graphicGapMatchChoiceImageAltPlaceholder',
        'graphicGapMatchChoiceImageMimeType',
        'graphicGapMatchMatchMax',
        'graphicGapMatchAdvanced',
        'graphicGapMatchChoiceIdentifier',
        'graphicGapMatchHtmlLabel',
        'graphicGapMatchHtmlPlaceholder',
        'graphicGapMatchFixed',
        'graphicGapMatchTargets',
        'graphicGapMatchAddTarget',
        'graphicGapMatchTargetsHelp',
        'graphicGapMatchTargetId',
        'graphicGapMatchTargetShape',
        'graphicGapMatchCoords',
        'graphicGapMatchCorrectChoice',
        'graphicGapMatchSelectChoice',
        'graphicGapMatchTargetEditor',
        'graphicGapMatchEditingTarget',
      ] as const
    ) expect(html).toContain(t(i18n, key, { number: 1 }));
    for (
      const [value, key] of [
        ['text', 'graphicGapMatchText'],
        ['image', 'graphicGapMatchImage'],
        ['rect', 'graphicGapMatchRect'],
        ['circle', 'graphicGapMatchCircle'],
        ['poly', 'graphicGapMatchPoly'],
      ] as const
    ) expect(html).toContain(`<option value="${value}">${t(i18n, key)}</option>`);
    expect(html).toContain('AUTHORED-TEXT');
    expect(html).toContain('AUTHORED-HTML');
    expect(html).toContain('&lt;em>' + t(i18n, 'graphicGapMatchHtmlPlaceholder') + '&lt;/em>');
    expect(html).toContain('https://example.test/c.png');
    expect(html).toContain('https://example.test/bg.png');
    expect(html).toContain('CHOICE-ALT');
    expect(html).toContain('AUTHORED-ALT');
    expect(html).toContain('AUTHORED-LONG');
    expect(html).toContain('image/png');
    expect(html).toContain('value="10,20,30"');
    expect(html).toContain('value="40,50,60,70"');
    expect(html).toContain('value="A"');
    expect(html).toContain('value="T1"');
    expect(html).toContain('placeholder="x,y,r"');
    expect(html).toContain('placeholder="x1,y1,x2,y2"');
    expect(html).toContain('<option selected value="A">A</option>');
    expect(html).toContain('value="0"');
    expect(html).toContain('value="2"');
    expect(html).toContain(t(i18n, 'graphicGapMatchChoice', { number: 2 }));
    expect(html).toContain(
      'aria-label="' + t(i18n, 'graphicGapMatchRemoveChoice', { number: 2 }) + '"',
    );
    expect(html).toContain(
      'aria-label="' + t(i18n, 'graphicGapMatchRemoveChoice', { number: 1 }) + '"',
    );
    expect(html).toContain(
      'aria-label="' + t(i18n, 'graphicGapMatchEditTarget', { number: 1 }) + '"',
    );
    expect(html).toContain(
      'aria-label="' + t(i18n, 'graphicGapMatchRemoveTarget', { number: 1 }) + '"',
    );
    expect(html).toContain(
      'aria-label="' + t(i18n, 'graphicGapMatchEditTarget', { number: 2 }) + '"',
    );
    expect(html).toContain(
      'aria-label="' + t(i18n, 'graphicGapMatchRemoveTarget', { number: 2 }) + '"',
    );
    expect(html).toContain('checked');
    expect(html).toContain('>' + t(i18n, 'edit') + '<');
    expect(html).toContain('>' + t(i18n, 'remove') + '<');
    if (!(!html.includes('driver.') && !/\{(?:count|plural|select)(?:[,}])/.test(html))) {
      expect.unreachable(
        "Expected !html.includes('driver.') && !/\\{(?:count|plural|select)(?:[,}])/.test(html)",
      );
    }
    if (locale === 'es-ES' || locale === 'es-419') assertNoEnglish(html);
  });
  testCase(`graphic gap match empty surface (${locale})`, () => {
    const i18n = createI18n(
      locale,
      createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces,
    );
    const html = view(locale, false, false, false);
    expect(html).toContain(t(i18n, 'graphicGapMatchChoicesEmpty'));
    expect(html).toContain(t(i18n, 'graphicGapMatchTargetsEmpty'));
    expect(html).toContain(t(i18n, 'graphicGapMatchCanvasEmpty'));
    if (!(!html.includes('driver.') && !/\{(?:count|plural|select)(?:[,}])/.test(html))) {
      expect.unreachable(
        "Expected !html.includes('driver.') && !/\\{(?:count|plural|select)(?:[,}])/.test(html)",
      );
    }
    if (locale === 'es-ES' || locale === 'es-419') assertNoEnglish(html);
  });
}
