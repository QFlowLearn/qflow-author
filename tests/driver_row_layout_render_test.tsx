import { expect, test as testCase } from 'vitest';

import type { ComponentChildren } from 'preact';
import { renderPage as renderToString } from './helpers/render_page.tsx';
import { GapMatchContent } from '../islands/drivers/gap_match.tsx';
import { HotspotContent } from '../islands/drivers/hotspot.tsx';
import { HottextContent } from '../islands/drivers/hottext.tsx';
import { InlineChoiceContent } from '../islands/drivers/inline_choice.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';

const noop = () => {};
const noIssue = () => false;
const noIssueText = () => undefined;
const renderAuthoring = (child: ComponentChildren) =>
  renderToString(
    <I18nProvider payload={createI18nPayload('en-US', catalogForLocale('en-US'), ['authoring'])}>
      {child}
    </I18nProvider>,
  );

testCase('inline choice renders a dedicated shuffle pin field for options', () => {
  const html = renderAuthoring(
    <InlineChoiceContent
      bodyHtml='<p><span data-qti-inline-choice="BLANK_1">Blank 1</span></p>'
      inlineChoices={[
        {
          id: 'BLANK_1',
          label: 'Blank 1',
          shuffle: true,
          options: [
            { id: 'A', text: 'Alpha', fixed: true, score: 1 },
            { id: 'B', text: 'Beta', score: 0 },
          ],
          correctId: 'A',
        },
      ]}
      responseMode='partial'
      renderPromptField={() => <div />}
      fieldHasIssue={noIssue}
      fieldIssueText={noIssueText}
      insertInlineChoiceSlot={noop}
      insertInlineChoiceSlotMarker={noop}
      removeInlineChoiceSlot={noop}
      updateInlineChoiceSlotLabel={noop}
      updateInlineChoiceSlotId={noop}
      setInlineChoiceSlotRequired={noop}
      setInlineChoiceSlotShuffle={noop}
      addInlineChoiceOption={noop}
      removeInlineChoiceOption={noop}
      updateInlineChoiceOptionText={noop}
      updateInlineChoiceOptionId={noop}
      setInlineChoiceCorrectId={noop}
      setInlineChoiceOptionFixed={noop}
      setInlineChoiceOptionScore={noop}
    />,
  );

  expect(html.includes('Shuffle pin')).toStrictEqual(true);
  expect(html.includes('Keep fixed while shuffling')).toStrictEqual(true);
});

testCase('gap match renders a dedicated pinned field for choice bank rows', () => {
  const html = renderAuthoring(
    <GapMatchContent
      bodyHtml='<p><span data-qti-gap="GAP_1">Gap 1</span></p>'
      shuffle
      allowPins
      gapResponseIdentifier='RESPONSE'
      gapChoices={[{ id: 'A', kind: 'text', text: 'Alpha', fixed: true, matchMax: 1 }]}
      gaps={[{ id: 'GAP_1', label: 'Gap 1' }]}
      correctGapPairs={[{ gapId: 'GAP_1', choiceId: 'A' }]}
      renderPromptField={() => <div />}
      fieldHasIssue={noIssue}
      fieldIssueText={noIssueText}
      setGapResponseIdentifier={noop}
      insertGap={noop}
      insertGapMarker={noop}
      removeGap={noop}
      updateGapLabel={noop}
      addGapChoice={noop}
      removeGapChoice={noop}
      updateGapChoiceText={noop}
      updateGapChoiceId={noop}
      updateGapChoiceMatchMax={noop}
      setGapChoiceFixed={noop}
      setCorrectChoiceForGap={noop}
    />,
  );

  expect(html.includes('Pinned')).toStrictEqual(true);
  expect(html.includes('Keep fixed while shuffling')).toStrictEqual(true);
  expect(html.includes('>Identifier<')).toStrictEqual(false);
  expect(html.includes('Correct answer')).toStrictEqual(true);
  expect(html.includes('A · Alpha')).toStrictEqual(true);
  expect(html.includes('md:grid-cols-[minmax(0,1fr)_minmax(16rem,28rem)]')).toStrictEqual(true);
});

testCase('hotspot renders a dedicated correct field separate from row actions', () => {
  const html = renderAuthoring(
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
    />,
  );

  expect(html.includes('Mark as correct')).toStrictEqual(true);
  expect(html.includes('Editing region')).toStrictEqual(true);
  expect(html.includes('>Editing<')).toStrictEqual(true);
});

testCase('hottext keeps correctness, text, status, and removal in one compact row', () => {
  const html = renderAuthoring(
    <HottextContent
      bodyHtml='<p><span data-qti-hottext="A">Alpha</span></p>'
      hottexts={[{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }]}
      correctIds={['A']}
      responseIdentifier='RESPONSE'
      maxChoices={1}
      renderPromptField={() => <div />}
      fieldHasIssue={noIssue}
      fieldIssueText={noIssueText}
      setResponseIdentifier={noop}
      insertHottext={noop}
      insertHottextMarker={noop}
      removeHottext={noop}
      updateHottextText={noop}
      setCorrectIds={noop}
    />,
  );

  expect(html.includes('md:grid-cols-[9rem_minmax(0,1fr)_auto]')).toStrictEqual(true);
  expect(html.includes('>Correct</span>')).toStrictEqual(true);
  expect(html.includes('>Span 1</span>')).toStrictEqual(true);
  expect(html.includes('>Text</span>')).toStrictEqual(false);
  expect(html.includes('ds-radio-sm')).toStrictEqual(true);
  expect(html.includes('ds-badge-sm')).toStrictEqual(true);
});
