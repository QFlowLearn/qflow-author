import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { GraphicOrderContent } from '../islands/drivers/graphic_order.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
const noop = () => {};
const common = {
  renderPromptField: (placeholder: string) => <span>{placeholder}</span>,
  fieldHasIssue: () => false,
  fieldIssueText: () => undefined,
};
const hotspots = [
  { id: 'HOTSPOT-RECT', shape: 'rect' as const, coords: '10,20,30,40', label: 'AUTHORED-RECT' },
  { id: 'HOTSPOT-CIRCLE', shape: 'circle' as const, coords: '50,60,7', label: 'AUTHORED-CIRCLE' },
  { id: 'HOTSPOT-POLY', shape: 'poly' as const, coords: '1,2,3,4,5,6', label: 'AUTHORED-POLY' },
  {
    id: 'HOTSPOT-ELLIPSE',
    shape: 'ellipse' as const,
    coords: '70,80,9,11',
    label: 'AUTHORED-ELLIPSE',
  },
  { id: 'HOTSPOT-DEFAULT', shape: 'default' as const, coords: '', label: 'AUTHORED-DEFAULT' },
];
const order = hotspots.map((hotspot) => hotspot.id);

function renderGraphicOrder(locale: (typeof locales)[number], empty: boolean): string {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  return render(
    <I18nProvider payload={payload}>
      <GraphicOrderContent
        {...common}
        promptHtml='<p>AUTHORED-PROMPT-Ω</p>'
        background={{
          source: 'data:image/png;base64,TECHNICAL-SOURCE',
          alt: 'AUTHORED-ALT-漢字',
          longDescription: 'AUTHORED-LONG-DESC',
          mimeType: 'image/png',
          width: 640,
          height: 480,
        }}
        graphicOrderResponseId='RESPONSE-ID'
        graphicOrderHotspots={empty ? [] : hotspots}
        graphicOrderOrder={empty ? [] : order}
        dragIndex={null}
        setPromptHtml={noop}
        setBackground={noop}
        setGraphicOrderResponseId={noop}
        addGraphicOrderHotspot={noop}
        removeGraphicOrderHotspot={noop}
        updateGraphicOrderHotspotId={noop}
        updateGraphicOrderHotspotShape={noop}
        updateGraphicOrderHotspotCoords={noop}
        updateGraphicOrderHotspotLabel={noop}
        setGraphicOrderOrder={noop}
        setDragIndex={noop}
        reorderGraphicOrder={noop}
      />
    </I18nProvider>,
  );
}

function expectText(
  html: string,
  i18n: ReturnType<typeof createI18n>,
  key: string,
  values?: Record<string, number>,
) {
  expect(html).toContain(i18n.t(key, values));
}

const oldEnglishPhrases = [
  'Background image',
  'Background alt text',
  'Describe the background',
  'Background long description (optional)',
  'Background MIME type',
  'Background width (px)',
  'Background height (px)',
  'Add hotspot',
  'Define hotspot shapes visually below; coordinates update automatically.',
  'Shape',
  'Coords',
  'Optional label',
  'Edit hotspot',
  'Remove hotspot',
  'Hotspot editor',
  'Editing hotspot',
  'Correct order',
  'Drag to reorder',
  'Add hotspots to define the orderable regions.',
  'Add hotspots to define the ordering.',
  'Drag to set the expected hotspot order.',
];

for (const locale of locales) {
  testCase(`graphic order SSR covers the complete i18n surface in ${locale}`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const populated = renderGraphicOrder(locale, false);
    const empty = renderGraphicOrder(locale, true);
    const localizedKeys = [
      'driver.graphicOrderPrompt',
      'driver.graphicOrderBackgroundSource',
      'driver.graphicOrderBackgroundAlt',
      'driver.graphicOrderBackgroundAltPlaceholder',
      'driver.graphicOrderBackgroundLongDescription',
      'driver.graphicOrderBackgroundMimeType',
      'driver.graphicOrderBackgroundWidth',
      'driver.graphicOrderBackgroundHeight',
      'driver.graphicOrderHotspots',
      'driver.graphicOrderAddHotspot',
      'driver.graphicOrderHotspotsHelp',
      'driver.graphicOrderId',
      'driver.shape',
      'driver.graphicOrderCoords',
      'driver.label',
      'driver.graphicOrderLabelPlaceholder',
      'driver.graphicOrderHotspotEditor',
      'driver.graphicOrderEditingHotspot',
      'driver.graphicOrderCorrectOrder',
      'driver.dragToReorder',
      'driver.graphicOrderOrderHelp',
    ];
    for (const key of localizedKeys) expectText(populated, i18n, key);
    for (
      const key of [
        'driver.graphicOrderPrompt',
        'driver.graphicOrderHotspots',
        'driver.graphicOrderHotspotsHelp',
        'driver.graphicOrderHotspotsEmpty',
        'driver.graphicOrderHotspotEditor',
        'driver.graphicOrderCorrectOrder',
        'driver.graphicOrderOrderEmpty',
        'driver.graphicOrderOrderHelp',
      ]
    ) expectText(empty, i18n, key);
    for (
      const [key, value] of [
        ['driver.graphicOrderRect', 'rect'],
        ['driver.circle', 'circle'],
        ['driver.graphicOrderPoly', 'poly'],
        ['driver.graphicOrderEllipse', 'ellipse'],
        ['driver.graphicOrderDefaultShape', 'default'],
      ] as const
    ) expect(populated).toContain(`<option value="${value}">${i18n.t(key)}</option>`);
    expect(populated).toContain('data:image/png;base64,TECHNICAL-SOURCE');
    for (const hotspot of hotspots) {
      expect(populated).toContain(hotspot.id);
      expect(populated).toContain(hotspot.label);
      if (hotspot.coords) expect(populated).toContain(`value="${hotspot.coords}"`);
    }
    expect(populated).toContain('placeholder="x,y,r"');
    expect(populated).toContain('placeholder="x1,y1,x2,y2"');
    for (const [index] of hotspots.entries()) {
      expectText(populated, i18n, 'driver.graphicOrderEditHotspot', { number: index + 1 });
      expectText(populated, i18n, 'driver.graphicOrderRemoveHotspot', { number: index + 1 });
    }
    expect(populated).toContain(`>${i18n.t('driver.edit')}</button>`);
    expect(populated).toContain(`>${i18n.t('driver.removeChoice')}</button>`);
    const removeButton = populated.match(
      new RegExp(
        `<button[^>]*aria-label="${
          i18n.t('driver.graphicOrderRemoveHotspot', { number: 1 })
        }"[^>]*>`,
      ),
    )?.[0];
    if (!removeButton) expect.unreachable('Expected removeButton');
    expect(removeButton).not.toMatch(/\s(?:disabled[\s=>]|aria-disabled="true")/);
    expect(populated).toContain(
      `placeholder="${i18n.t('driver.graphicOrderBackgroundAltPlaceholder')}"`,
    );
    expect(populated).toContain('AUTHORED-ALT-漢字');
    expect(populated).toContain('AUTHORED-LONG-DESC');
    expect(populated).toContain('value="image/png"');
    expect(populated).toContain('value="640"');
    expect(populated).toContain('value="480"');
    expect(empty).toContain('AUTHORED-ALT-漢字');
    expect(empty).toContain('AUTHORED-LONG-DESC');
    expect(empty).toContain('value="image/png"');
    // ResponseIdentifierDisclosure intentionally renders no markup.
    expect(populated).not.toMatch(/driver\.[A-Za-z][\w.]*/);
    expect(empty).not.toMatch(/driver\.[A-Za-z][\w.]*/);
    expect(populated).not.toMatch(/\{(?:number|label)\}/);
    expect(empty).not.toMatch(/\{(?:number|label)\}/);
    if (locale === 'es-ES' || locale === 'es-419') {
      for (const phrase of oldEnglishPhrases) {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(populated).not.toMatch(new RegExp(escaped));
        expect(empty).not.toMatch(new RegExp(escaped));
      }
    }
  });
}
