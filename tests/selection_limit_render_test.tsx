import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { HotspotContent } from '../islands/drivers/hotspot.tsx';
import { HottextContent } from '../islands/drivers/hottext.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

const noop = () => {};
const noIssue = () => false;
const noIssueText = () => undefined;
const authoringPayload = createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring']);

function renderHottext(maxChoices?: number) {
  return renderToString(
    <I18nProvider payload={authoringPayload}>
      <HottextContent
        bodyHtml='<p><span data-qti-hottext="A">A</span> <span data-qti-hottext="B">B</span></p>'
        hottexts={[{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }]}
        correctIds={['A']}
        responseIdentifier='RESPONSE'
        renderPromptField={() => <div />}
        fieldHasIssue={noIssue}
        fieldIssueText={noIssueText}
        setResponseIdentifier={noop}
        insertHottext={noop}
        insertHottextMarker={noop}
        removeHottext={noop}
        updateHottextText={noop}
        setCorrectIds={noop}
        maxChoices={maxChoices}
      />
    </I18nProvider>,
  );
}

function renderHotspot(maxChoices?: number) {
  return renderToString(
    <I18nProvider payload={authoringPayload}>
      <HotspotContent
        image={{ source: 'image.png', alt: 'Diagram' }}
        responseIdentifier='RESPONSE'
        choices={[
          { id: 'A', shape: 'circle', coords: '50,50,10' },
          { id: 'B', shape: 'rect', coords: '10,10,30,30' },
        ]}
        correctIds={['A']}
        renderPromptField={() => <div />}
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
        maxChoices={maxChoices}
      />
    </I18nProvider>,
  );
}

testCase('hottext renders multi-select controls when maxChoices is unlimited', () => {
  const html = renderHottext(undefined);
  expect(html.includes('type="radio"')).toStrictEqual(false);
  expect(html.includes('type="checkbox"')).toStrictEqual(true);
});

testCase('hottext renders single-select controls when maxChoices is 1', () => {
  const html = renderHottext(1);
  expect(html.includes('type="radio"')).toStrictEqual(true);
});

testCase('hotspot renders multi-select controls when maxChoices is unlimited', () => {
  const html = renderHotspot(undefined);
  expect(html.includes('type="radio"')).toStrictEqual(false);
  expect(html.includes('type="checkbox"')).toStrictEqual(true);
});

testCase('hotspot renders single-select controls when maxChoices is 1', () => {
  const html = renderHotspot(1);
  expect(html.includes('type="radio"')).toStrictEqual(true);
});
