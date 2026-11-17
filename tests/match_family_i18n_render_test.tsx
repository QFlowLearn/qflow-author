import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { parseInterfaceLocale } from '../lib/i18n/locale.ts';
import { MatchContent } from '../islands/drivers/match.tsx';
import { AssociateContent } from '../islands/drivers/associate.tsx';
import { InlineChoiceContent } from '../islands/drivers/inline_choice.tsx';
import { GapMatchContent } from '../islands/drivers/gap_match.tsx';
import MatchMatrix from '../islands/MatchMatrix.tsx';
import AssociateMatrix from '../islands/AssociateMatrix.tsx';
import { AssociationLimitField } from '../islands/drivers/association_limit_field.tsx';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
const noop = () => {};
const common = {
  renderPromptField: (placeholder: string) => <input placeholder={placeholder} />,
  fieldHasIssue: () => false,
  fieldIssueText: () => undefined,
  plainTextValue: (text?: string) => text ?? '',
};

for (const locale of locales) {
  testCase(`match family production surfaces are localized in ${locale}`, () => {
    const parsed = parseInterfaceLocale(locale);
    if (!parsed) throw new Error(`Unsupported locale ${locale}`);
    const payload = createI18nPayload(parsed, catalogForLocale(parsed), ['authoring']);
    const i18n = createI18n(parsed, payload.namespaces);
    const html = render(
      <I18nProvider payload={payload}>
        <div>
          <AssociationLimitField
            value={0}
            onChange={noop}
            ariaLabel={i18n.t('driver.maxAssociations')}
          />
          <MatchContent
            {...common}
            sources={[{ id: 'S', text: 'FUENTE-Ω', matchMax: 1 }]}
            targets={[{ id: 'T', text: 'DESTINO-漢字', matchMax: 1 }]}
            addSource={noop}
            addTarget={noop}
            updateSourceText={noop}
            updateTargetText={noop}
            updateSourceMax={noop}
            updateTargetMax={noop}
            removeSource={noop}
            removeTarget={noop}
            pairs={[{ sourceId: 'S', targetId: 'T' }]}
            setPairs={noop}
            maxAssociations={2}
            setMaxAssociations={noop}
          />
          <AssociateContent
            {...common}
            choices={[
              { id: 'A', text: 'CHOICE-✓', matchMax: 1 },
              { id: 'B', text: 'Choice B', matchMax: 1 },
            ]}
            addChoice={noop}
            updateChoiceText={noop}
            updateChoiceMatchMax={noop}
            removeChoice={noop}
            pairs={[]}
            setPairs={noop}
            maxAssociations={0}
          />
          <MatchMatrix
            sources={[{ id: 'S', text: 'FUENTE-Ω', matchMax: 1 }]}
            targets={[{ id: 'T', text: 'DESTINO-漢字', matchMax: 1 }]}
            pairs={[]}
            onChange={noop}
            maxAssociations={1}
          />
          <AssociateMatrix
            choices={[
              { id: 'A', text: 'CHOICE-✓', matchMax: 1 },
              { id: 'B', text: 'Choice B', matchMax: 1 },
            ]}
            pairs={[]}
            onChange={noop}
            maxAssociations={1}
            rowLabel={i18n.t('driver.choices')}
          />
          <InlineChoiceContent
            {...common}
            bodyHtml='<p>AUTHORED-BODY-Ω</p>'
            inlineChoices={[]}
            responseMode='partial'
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
          />
          <InlineChoiceContent
            {...common}
            bodyHtml='<p>INLINE-AUTHORED-Ω <span data-qti-inline-choice="RESPONSE_1">RESPONSE_1</span></p>'
            inlineChoices={[{
              id: 'RESPONSE_1',
              label: '',
              required: true,
              shuffle: true,
              options: [{ id: 'A', text: 'CHOICE-漢字' }, { id: 'B', text: 'Choice B' }],
              correctId: 'B',
            }]}
            responseMode='partial'
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
          />
          <GapMatchContent
            {...common}
            bodyHtml='<p>AUTHORED-GAP-Ω</p>'
            shuffle
            allowPins
            gapResponseIdentifier='RESPONSE'
            setGapResponseIdentifier={noop}
            gapChoices={[]}
            gaps={[]}
            correctGapPairs={[]}
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
          />
        </div>
      </I18nProvider>,
    );
    for (
      const id of [
        'driver.sources',
        'driver.targets',
        'driver.correctPairs',
        'driver.associationHelp',
        'driver.inlineChoices',
        'driver.gaps',
        'driver.choiceBank',
        'driver.emptyGaps',
      ]
    ) {
      expect(html).toContain(i18n.t(id));
    }
    expect(html).toContain('FUENTE-Ω');
    expect(html).toContain('DESTINO-漢字');
    expect(html).toContain('CHOICE-✓');
    expect(html).toContain('CHOICE-漢字');
    expect(html).toContain(i18n.t('driver.blank', { number: 1 }));
    expect(html).toContain(i18n.t('driver.gap', { number: 1 }));
    expect(html).toContain(i18n.t('driver.placedInBody'));
    expect(html).toContain(i18n.t('driver.slotLabel'));
    expect(html).toContain('S');
    expect(html).toContain('T');
    expect(html).toContain('0/1');
    if (html.includes('driver.')) expect.unreachable("Expected !html.includes('driver.')");
    if (locale.startsWith('es-')) {
      const visibleText = html.replace(/<[^>]*>/g, ' ');
      for (
        const phrase of [
          'Sources',
          'Targets',
          'Correct pairs',
          'Inline choice slots',
          'Choice bank',
        ]
      ) {
        if (visibleText.includes(phrase)) expect.unreachable(`${locale} leaked ${phrase}`);
      }
    }
  });
}
