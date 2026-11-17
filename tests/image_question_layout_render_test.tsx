import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { GraphicGapMatchContent } from '../islands/drivers/graphic_gap_match.tsx';
import { GraphicOrderContent } from '../islands/drivers/graphic_order.tsx';
import { PositionObjectContent } from '../islands/drivers/position_object.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

const noop = () => {};
const commonProps = {
  renderPromptField: () => <div />,
  fieldHasIssue: () => false,
  fieldIssueText: () => undefined,
};
const enPayload = createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring']);

testCase(
  'GraphicGapMatchContent keeps background accessibility fields with the image workflow',
  () => {
    const html = renderToString(
      <I18nProvider payload={enPayload}>
        <GraphicGapMatchContent
          {...commonProps}
          graphicBackground={{ source: '', alt: '', longDescription: '', mimeType: '' }}
          graphicResponseId='RESPONSE'
          graphicChoices={[
            {
              id: 'A',
              kind: 'image',
              imgSrc: '',
              imgAlt: '',
              matchMax: 1,
            },
          ]}
          graphicTargets={[
            { id: 'T1', shape: 'circle', coords: '120,120,20', matchMax: 1 },
          ]}
          graphicCorrectPairs={[]}
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
        />
      </I18nProvider>,
    );

    expect(html).toContain('lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]');
    expect(html).toContain('rows="4"');
    if (!(html.indexOf('Image alt text') < html.indexOf('Advanced'))) {
      expect.unreachable("Expected html.indexOf('Image alt text') < html.indexOf('Advanced')");
    }
    expect(html).toContain('Editing target');
    expect(html.match(/Set a background image to draw targets\./g)?.length).toStrictEqual(1);
  },
);

testCase('GraphicOrderContent uses the shared image settings rhythm', () => {
  const html = renderToString(
    <I18nProvider payload={enPayload}>
      <GraphicOrderContent
        {...commonProps}
        promptHtml=''
        background={{ source: '', alt: '', longDescription: '', mimeType: '' }}
        graphicOrderResponseId='RESPONSE'
        graphicOrderHotspots={[
          { id: 'A', shape: 'circle', coords: '120,120,20', label: 'First' },
        ]}
        graphicOrderOrder={['A']}
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

  expect(html).toContain('lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]');
  expect(html).toContain('rows="4"');
  expect(html).toContain('ds-input-sm');
  expect(html).toContain('Editing hotspot');
});

testCase('PositionObjectContent groups both images and their related settings', () => {
  const payload = createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring']);
  const i18n = createI18n('en-US', payload.namespaces);
  const html = renderToString(
    <I18nProvider payload={payload}>
      <PositionObjectContent
        {...commonProps}
        responseIdentifier='RESPONSE'
        stageImage={{ source: '', alt: '', longDescription: '', mimeType: '' }}
        objectImage={{ source: '', alt: '', mimeType: '' }}
        centerPoint=''
        targets={[]}
        correctPoints={[]}
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

  expect(html).toContain('<legend');
  expect(html).toContain(i18n.t('driver.positionObjectStageImage'));
  expect(html).toContain(i18n.t('driver.positionObjectObjectImage'));
  expect(html).toContain(i18n.t('driver.positionObjectCenterPoint'));
  expect(html.match(/lg:grid-cols-\[minmax\(0,1\.1fr\)_minmax\(18rem,0\.9fr\)\]/g)?.length)
    .toStrictEqual(2);
});
