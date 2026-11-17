import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { HotspotContent } from '../islands/drivers/hotspot.tsx';
import { HotspotCanvasEditor } from '../islands/drivers/hotspot_canvas_editor.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n, type I18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../lib/i18n/locale.ts';

const locales: readonly InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
const noop = () => {};
const noIssue = () => false;
const noIssueText = () => undefined;

function renderContent(
  locale: InterfaceLocale,
  choices: { id: string; shape: 'circle' | 'rect' | 'poly'; coords: string }[],
  image = { source: '', alt: '' },
) {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  return renderToString(
    <I18nProvider payload={payload}>
      <HotspotContent
        image={image}
        responseIdentifier='RESPONSE'
        choices={choices}
        correctIds={choices.length ? [choices[0].id] : []}
        renderPromptField={(placeholder) => (
          <input aria-label='AUTHORED-PROMPT-Ω' placeholder={placeholder} />
        )}
        fieldHasIssue={noIssue}
        fieldIssueText={noIssueText}
        setImage={noop}
        setResponseIdentifier={noop}
        setCorrectIds={noop}
        addHotspotChoice={noop}
        removeHotspotChoice={noop}
        updateHotspotChoiceId={noop}
        updateHotspotChoiceShape={noop}
        updateHotspotChoiceCoords={noop}
        maxChoices={1}
      />
    </I18nProvider>,
  );
}

function renderCanvas(locale: InterfaceLocale, shape?: 'circle' | 'rect' | 'poly' | 'ellipse') {
  const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
  return renderToString(
    <I18nProvider payload={payload}>
      <HotspotCanvasEditor
        backgroundSrc='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="20"/%3E'
        backgroundAlt='AUTHORED-ALT-漢字'
        hotspots={shape
          ? [{ id: 'R-Ω', shape, coords: shape === 'poly' ? '1,2,3,4,5,6' : '10,11,12,13' }]
          : []}
        activeHotspotId={shape ? 'R-Ω' : ''}
        updateHotspotCoords={noop}
      />
    </I18nProvider>,
  );
}

function assertSafeOutput(output: string) {
  if (output.includes('driver.')) expect.unreachable("Expected !output.includes('driver.')");
  if (output.match(/\{(?:count|plural|select)(?:[,}])/)) {
    expect.unreachable('Expected !output.match(/\\{(?:count|plural|select)(?:[,}])/)');
  }
}

for (const locale of locales) {
  testCase(`hotspot authoring is localized and preserves data (${locale})`, () => {
    const i18n: I18n = createI18n(
      locale,
      createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces,
    );
    const empty = renderContent(locale, []);
    expect(empty).toContain(i18n.t('driver.hotspotPrompt'));
    for (
      const key of [
        'hotspotImageSource',
        'hotspotImageAlt',
        'hotspotImageAltPlaceholder',
        'hotspotImageLongDescription',
        'hotspotImageMimeType',
      ] as const
    ) expect(empty).toContain(i18n.t(`driver.${key}`));
    expect(empty).toContain(i18n.t('driver.hotspotRegions'));
    expect(empty).toContain(i18n.t('driver.hotspotAddRegion'));
    expect(empty).toContain(i18n.t('driver.hotspotEmpty'));
    expect(empty).toContain(i18n.t('driver.hotspotCanvasEmpty'));
    expect(empty).toContain(i18n.t('driver.hotspotCanvasFollowup'));
    expect(empty).toContain(i18n.t('driver.hotspotStarterHelp'));
    assertSafeOutput(empty);

    const populated = renderContent(locale, [
      { id: 'A<&-Ω', shape: 'circle', coords: '50,50,10' },
      { id: 'B', shape: 'rect', coords: '10,10,30,30' },
      { id: 'C', shape: 'poly', coords: '1,2,3,4,5,6' },
    ], { source: 'https://example.test/a?x=1&y=2', alt: 'ALT<&-漢字' });
    for (
      const key of [
        'hotspotImageSource',
        'hotspotImageAlt',
        'hotspotImageAltPlaceholder',
        'hotspotImageLongDescription',
        'hotspotImageMimeType',
        'hotspotRegions',
        'hotspotHelp',
        'identifier',
        'shape',
        'coordinates',
        'correct',
        'markCorrect',
        'editing',
        'edit',
        'remove',
        'regionEditor',
        'editingRegion',
      ] as const
    ) {
      expect(populated).toContain(i18n.t(`driver.${key}`));
    }
    for (
      const [value, key] of [['circle', 'circle'], ['rect', 'rectangle'], [
        'poly',
        'polygon',
      ]] as const
    ) {
      if (!(populated.includes(`value="${value}"`))) {
        expect.unreachable('Expected populated.includes(`value="${value}"`)');
      }
      expect(populated).toContain(i18n.t(`driver.${key}`));
    }
    if (!(populated.includes('A&lt;&amp;-Ω'))) {
      expect.unreachable("Expected populated.includes('A&lt;&amp;-Ω')");
    }
    if (!(populated.includes('ALT&lt;&amp;-漢字'))) {
      expect.unreachable("Expected populated.includes('ALT&lt;&amp;-漢字')");
    }
    if (!(populated.includes('https://example.test/a?x=1&amp;y=2'))) {
      expect.unreachable("Expected populated.includes('https://example.test/a?x=1&amp;y=2')");
    }
    if (!(populated.includes('50,50,10'))) {
      expect.unreachable("Expected populated.includes('50,50,10')");
    }
    assertSafeOutput(populated);
    if (locale === 'es-ES' || locale === 'es-419') {
      for (
        const phrase of [
          'Hotspot regions',
          'Add region',
          'Coordinates',
          'Mark as correct',
          'Region editor',
        ]
      ) {
        if (populated.includes(phrase)) expect.unreachable(`${locale} leaked ${phrase}`);
      }
    }
  });

  testCase(`hotspot canvas instructions are localized (${locale})`, () => {
    const shapeKeys = [
      ['circle', 'hotspotInstructionCircle'],
      ['rect', 'hotspotInstructionRectangle'],
      ['ellipse', 'hotspotInstructionEllipse'],
      ['poly', 'hotspotInstructionPolygon'],
    ] as const;
    const i18n: I18n = createI18n(
      locale,
      createI18nPayload(locale, catalogForLocale(locale), ['authoring']).namespaces,
    );
    for (const [shape, key] of shapeKeys) {
      const output = renderCanvas(locale, shape);
      expect(output).toContain(i18n.t(`driver.${key}`));
      assertSafeOutput(output);
    }
    const noActive = renderCanvas(locale);
    expect(noActive).toContain(i18n.t('driver.hotspotInstructionSelect'));
    assertSafeOutput(noActive);
    const polygon = renderCanvas(locale, 'poly');
    expect(polygon).toContain(i18n.t('driver.undoPolygonPoint'));
    expect(polygon).toContain(i18n.t('driver.clearPolygon'));
    assertSafeOutput(polygon);
  });
}
