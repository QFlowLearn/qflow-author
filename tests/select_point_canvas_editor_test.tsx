import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';

import {
  clientPositionToImagePoint,
  formatSelectPoint,
  moveSelectPoint,
  parseSelectPoint,
  SelectPointCorrectPointsEditor,
} from '../islands/drivers/select_point_canvas_editor.tsx';
import { SelectPointContent } from '../islands/drivers/select_point.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

const noop = () => {};

testCase('select point editor converts client positions to image coordinates', () => {
  const point = clientPositionToImagePoint(
    300,
    150,
    { left: 100, top: 50, width: 400, height: 200 },
    { width: 800, height: 400 },
  );

  expect(point).toStrictEqual({ x: 400, y: 200 });
  if (!point) expect.unreachable('Expected point');
  expect(formatSelectPoint(point)).toStrictEqual('400 200');
  expect(parseSelectPoint('400, 200')).toStrictEqual({ x: 400, y: 200 });
});

testCase('select point editor keeps keyboard movement inside the image', () => {
  const size = { width: 320, height: 240 };

  expect(moveSelectPoint({ x: 2, y: 2 }, 'ArrowLeft', 10, size)).toStrictEqual({ x: 0, y: 2 });
  expect(moveSelectPoint({ x: 318, y: 238 }, 'ArrowDown', 10, size)).toStrictEqual({
    x: 318,
    y: 240,
  });
});

testCase('select point editor renders an accessible visual point control', () => {
  const i18n = createI18n(
    'en-US',
    createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring']).namespaces,
  );
  const html = renderToString(
    <I18nProvider payload={createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring'])}>
      <SelectPointCorrectPointsEditor
        imageSrc='timeline.png'
        imageAlt='Presidential timeline'
        imageWidth={640}
        imageHeight={360}
        maxChoices={2}
        value={['120 130', '240 130']}
        onChange={() => {}}
      />
    </I18nProvider>,
  );

  expect(html).toContain(`aria-label="${i18n.t('driver.selectPointPlace', { number: 1 })}"`);
  expect(html).toContain(i18n.t('driver.selectPointInstruction', {
    point: i18n.t('driver.selectPointIndexed', { number: 1 }),
  }));
  expect(html).toContain('cx="120" cy="130" r="11"');
  expect(html).toContain('Presidential timeline');
});

testCase('select point authoring integrates the visual editor with correct points', () => {
  const payload = createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring']);
  const i18n = createI18n('en-US', payload.namespaces);
  const html = renderToString(
    <I18nProvider payload={payload}>
      <SelectPointContent
        responseIdentifier='RESPONSE'
        image={{ source: 'timeline.png', alt: 'Presidential timeline', width: 640, height: 360 }}
        maxChoices={1}
        targets={[{ shape: 'circle', coords: '120,130,18', mappedValue: 1 }]}
        correctPoints={['120 130']}
        renderPromptField={() => <div />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
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

  expect(html).toContain(i18n.t('driver.selectPointEditor'));
  expect(html).toContain(i18n.t('driver.selectPointPlace', { number: 1 }));
  expect(html).toContain(`>${i18n.t('driver.editing')}</span>`);
  expect(html).toContain(`>${i18n.t('driver.selectPointCorrectPoint')}</strong>`);
  expect(html.includes('+ Add point')).toStrictEqual(false);
});

testCase('select point authoring shows and enforces the configured point limit', () => {
  const payload = createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring']);
  const i18n = createI18n('en-US', payload.namespaces);
  const html = renderToString(
    <I18nProvider payload={payload}>
      <SelectPointContent
        responseIdentifier='RESPONSE'
        image={{
          source: 'timeline.png',
          alt: 'Presidential timeline',
          width: 640,
          height: 360,
        }}
        maxChoices={2}
        targets={[]}
        correctPoints={['120 130', '240 130']}
        renderPromptField={() => <div />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
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

  expect(html).toContain(`>${i18n.t('driver.selectPointCorrectPoints')}</strong>`);
  expect(html).toContain(
    `>${i18n.t('driver.selectPointCountOfLimit', { count: 2, limit: 2 })}</span>`,
  );
  expect(html).toContain('disabled');
  expect(html).toContain(i18n.t('driver.selectPointAddPoint'));
});
