import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { GraphicAssociateContent } from '../islands/drivers/graphic_associate.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';
import type { GraphicAssociateHotspot } from '../lib/types/graphic_associate.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
const noop = () => {};
const background = {
  source: 'data:image/png;base64,AAAA',
  alt: 'AUTHORED-BACKGROUND-ALT',
  longDescription: 'AUTHORED-LONG-DESC',
  mimeType: 'image/png',
  width: 640,
  height: 480,
};
const oldEnglishSurface = [
  'Background image',
  'Background alt text',
  'Background long description (optional)',
  'Background MIME type',
  'Background width (px)',
  'Background height (px)',
  'Hotspots',
  'Add hotspot',
  'Define hotspot shapes visually below; coordinates update automatically.',
  'Shape',
  'Coords',
  'Max links',
  'Maximum links for hotspot',
  '>Edit<',
  '>Remove<',
  'Correct pairs',
  'Pairing is unordered:',
  '>Rect<',
  '>Circle<',
  '>Poly<',
];

function assertSpanishSurface(html: string) {
  for (const phrase of oldEnglishSurface) {
    if (html.includes(phrase)) expect.unreachable('Expected !html.includes(phrase)');
  }
}

function render(
  locale: InterfaceLocale,
  hotspots: GraphicAssociateHotspot[] = [{
    id: 'ZONE_A',
    shape: 'circle',
    coords: '120,90,18',
    matchMax: 0,
  }],
) {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  return renderToString(
    <I18nProvider payload={payload}>
      <GraphicAssociateContent
        promptHtml='<p>AUTHORED-PROMPT-Ω</p>'
        background={background}
        graphicAssociateResponseId='RESPONSE_Ω'
        graphicAssociateHotspots={hotspots}
        graphicAssociateCorrectPairs={hotspots.length > 1
          ? [{ sourceId: hotspots[0].id, targetId: hotspots[1].id }]
          : []}
        maxAssociations={3}
        renderPromptField={(placeholder) => <input placeholder={placeholder} />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
        setPromptHtml={noop}
        setBackground={noop}
        setGraphicAssociateResponseId={noop}
        addGraphicAssociateHotspot={noop}
        removeGraphicAssociateHotspot={noop}
        updateGraphicAssociateHotspotId={noop}
        updateGraphicAssociateHotspotShape={noop}
        updateGraphicAssociateHotspotCoords={noop}
        updateGraphicAssociateHotspotMatchMax={noop}
        setGraphicAssociatePairs={noop}
      />
    </I18nProvider>,
  );
}

for (const locale of locales) {
  testCase(`graphic associate localization (${locale})`, () => {
    const i18n = createI18n(
      locale,
      createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces,
    );
    const html = render(locale, [
      { id: 'ZONE_A', shape: 'circle', coords: '120,90,18', matchMax: 0 },
      { id: 'ZONE_B', shape: 'rect', coords: 'x1,y1,x2,y2', matchMax: 2 },
    ]);
    for (
      const key of [
        'graphicAssociatePrompt',
        'graphicAssociateBackgroundSource',
        'graphicAssociateBackgroundAlt',
        'graphicAssociateBackgroundAltPlaceholder',
        'graphicAssociateBackgroundLongDescription',
        'graphicAssociateBackgroundMimeType',
        'graphicAssociateBackgroundWidth',
        'graphicAssociateBackgroundHeight',
        'graphicAssociateHotspots',
        'graphicAssociateAddHotspot',
        'graphicAssociateHotspotsHelp',
        'graphicAssociateId',
        'graphicAssociateShape',
        'graphicAssociateRect',
        'graphicAssociateCircle',
        'graphicAssociatePoly',
        'graphicAssociateCoords',
        'graphicAssociateMaximumLinks',
        'graphicAssociateMaxLinks',
        'graphicAssociateHotspotEditor',
        'graphicAssociateEditingHotspot',
        'graphicAssociateCorrectPairs',
        'graphicAssociateMatrixRowLabel',
        'graphicAssociateUnorderedPairHelp',
      ] as const
    ) expect(html).toContain(i18n.t(`driver.${key}`, { id: 'ZONE_A' }));
    for (
      const [value, label] of [
        ['rect', i18n.t('driver.graphicAssociateRect')],
        ['circle', i18n.t('driver.graphicAssociateCircle')],
        ['poly', i18n.t('driver.graphicAssociatePoly')],
      ]
    ) expect(html).toContain(`<option value="${value}">${label}</option>`);
    expect(html).toContain(
      '<option selected value="circle">' + i18n.t('driver.graphicAssociateCircle') + '</option>',
    );
    expect(html).toContain(
      '<option selected value="rect">' + i18n.t('driver.graphicAssociateRect') + '</option>',
    );
    expect(html).toContain('value="120,90,18"');
    expect(html).toContain('value="x1,y1,x2,y2"');
    expect(html).toContain('placeholder="x,y,r"');
    expect(html).toContain('placeholder="x1,y1,x2,y2"');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('AUTHORED-BACKGROUND-ALT');
    expect(html).toContain('AUTHORED-LONG-DESC');
    expect(html).toContain('value="image/png"');
    expect(html).toContain('value="640"');
    expect(html).toContain('value="480"');
    expect(html).toContain('value="0"');
    expect(html).toContain('value="2"');
    expect(html).toContain('title="ZONE_A"');
    expect(html).toContain('title="ZONE_B"');
    expect(html).toContain('disabled');
    expect(html).toContain('>' + i18n.t('driver.edit') + '<');
    expect(html).toContain('>' + i18n.t('driver.remove') + '<');
    expect(html).toContain(
      'aria-label="' + i18n.t('driver.graphicAssociateEditHotspot', { number: 1 }) + '"',
    );
    expect(html).toContain(
      'aria-label="' + i18n.t('driver.graphicAssociateRemoveHotspot', { number: 2 }) + '"',
    );
    expect(html).toContain(i18n.t('driver.graphicAssociateMaximumLinks', { id: 'ZONE_A' }));
    expect(html).toContain(i18n.t('driver.pairLabel', { source: 'ZONE_A', target: 'ZONE_B' }));
    expect(html).toContain(i18n.t('driver.maxAssociationsSummary', { max: 3, count: 1 }));
    expect(html).toContain(i18n.t('driver.associationHelp'));
    if (!(!html.includes('driver.') && !/\{(?:count|plural|select)(?:[,}])/.test(html))) {
      expect.unreachable(
        "Expected !html.includes('driver.') && !/\\{(?:count|plural|select)(?:[,}])/.test(html)",
      );
    }
    if (locale === 'es-ES' || locale === 'es-419') assertSpanishSurface(html);
  });

  testCase(`graphic associate empty state localization (${locale})`, () => {
    const i18n = createI18n(
      locale,
      createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces,
    );
    const html = render(locale, []);
    expect(html).toContain(i18n.t('driver.graphicAssociateHotspotsEmpty'));
    expect(html).toContain(i18n.t('driver.graphicAssociateHotspots'));
    expect(html).toContain('placeholder="' + i18n.t('driver.graphicAssociatePrompt') + '"');
    if (!(!html.includes('driver.') && !/\{(?:count|plural|select)(?:[,}])/.test(html))) {
      expect.unreachable(
        "Expected !html.includes('driver.') && !/\\{(?:count|plural|select)(?:[,}])/.test(html)",
      );
    }
    if (locale === 'es-ES' || locale === 'es-419') assertSpanishSurface(html);
  });
}
