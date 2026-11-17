import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import Button from '../components/ui/Button.tsx';
import { AssociateContent } from '../islands/drivers/associate.tsx';
import { GraphicAssociateContent } from '../islands/drivers/graphic_associate.tsx';
import { MatchContent } from '../islands/drivers/match.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

const noop = () => {};

testCase('associate renders association-limit guidance once for the choice list', () => {
  const html = renderToString(
    <I18nProvider payload={createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring'])}>
      <AssociateContent
        choices={[
          { id: 'A', text: 'George Washington', matchMax: 1 },
          { id: 'B', text: 'Two-term precedent', matchMax: 1 },
          { id: 'C', text: 'Abraham Lincoln', matchMax: 1 },
        ]}
        addChoice={noop}
        updateChoiceText={noop}
        updateChoiceMatchMax={noop}
        removeChoice={noop}
        pairs={[]}
        setPairs={noop}
        plainTextValue={(text) => text ?? ''}
        renderPromptField={() => <div />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
      />
    </I18nProvider>,
  );

  expect(html.match(/Use 0 for unlimited\./g)?.length).toStrictEqual(1);
  expect(html.includes('Limit links for this choice.')).toStrictEqual(false);
});

testCase('match renders association-limit guidance once per list instead of once per row', () => {
  const html = renderToString(
    <I18nProvider payload={createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring'])}>
      <MatchContent
        sources={[
          { id: 'A', text: 'George Washington', matchMax: 1 },
          { id: 'B', text: 'Abraham Lincoln', matchMax: 1 },
        ]}
        targets={[
          { id: '1', text: 'First president', matchMax: 1 },
          { id: '2', text: 'Emancipation Proclamation', matchMax: 1 },
        ]}
        addSource={noop}
        addTarget={noop}
        updateSourceText={noop}
        updateTargetText={noop}
        updateSourceMax={noop}
        updateTargetMax={noop}
        removeSource={noop}
        removeTarget={noop}
        pairs={[]}
        setPairs={noop}
        setMaxAssociations={noop}
        plainTextValue={(text) => text ?? ''}
        renderPromptField={() => <div />}
        fieldHasIssue={() => false}
        fieldIssueText={() => undefined}
      />
    </I18nProvider>,
  );

  expect(html.match(/use 0 for unlimited\./g)?.length).toStrictEqual(2);
  expect(html.includes('Limit links from this source.')).toStrictEqual(false);
  expect(html.includes('Limit links to this target.')).toStrictEqual(false);
});

testCase('graphic associate renders max-link guidance once for the hotspot list', () => {
  const html = renderToString(
    <I18nProvider payload={createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring'])}>
      <GraphicAssociateContent
        promptHtml=''
        background={{ source: '', alt: '', longDescription: '', mimeType: '' }}
        graphicAssociateResponseId='RESPONSE'
        graphicAssociateHotspots={[
          { id: 'A', shape: 'circle', coords: '120,90,18', matchMax: 1 },
          { id: 'B', shape: 'circle', coords: '120,170,18', matchMax: 1 },
        ]}
        graphicAssociateCorrectPairs={[]}
        renderPromptField={() => <div />}
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

  expect(html.match(/Set Max links to 0 to allow unlimited connections\./g)?.length).toStrictEqual(
    1,
  );
  expect(html.includes('Set a cap for this item.')).toStrictEqual(false);
  expect(html.includes('Editing hotspot')).toStrictEqual(true);
});

testCase('danger ghost buttons keep destructive color quiet until interaction', () => {
  const html = renderToString(
    <Button type='button' size='xs' variant='danger-ghost'>Remove</Button>,
  );

  expect(html.includes('text-base-content/70')).toStrictEqual(true);
  expect(html.includes('hover:text-error')).toStrictEqual(true);
  expect(html.includes('focus-visible:text-error')).toStrictEqual(true);
});
