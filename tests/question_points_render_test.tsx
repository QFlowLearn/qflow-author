import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import ItemEditorProvider from '../islands/item_editor/ItemEditorProvider.tsx';
import { useItemEditorState } from '../islands/item_editor/context.ts';
import QuestionPoints from '../components/item_editor/QuestionPoints.tsx';
import Button from '../components/ui/Button.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { playerMessageCatalogForLocale } from '../lib/i18n/player_messages/catalogs.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import type { QuestionPointEditingAuthority } from '../lib/question_point_authority.ts';
import type { Draft } from '../lib/types/draft.ts';

function Controls() {
  const { persistence } = useItemEditorState();
  return (
    <>
      <QuestionPoints />
      <Button disabled={!persistence.canSave}>Save</Button>
    </>
  );
}

for (const locale of INTERFACE_LOCALES) {
  testCase(`point controls enforce source authority before interaction in ${locale}`, () => {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['authoring']);
    const i18n = createI18n(locale, payload.namespaces);
    const cases: readonly {
      readonly authority: QuestionPointEditingAuthority;
      readonly maximumScore: number | undefined;
      readonly partial?: boolean;
      readonly preserveSourceXml?: boolean;
      readonly custom?: 'mode' | 'xml';
      readonly readOnly: boolean;
      readonly blocked: boolean;
      readonly message?: string;
    }[] = [
      {
        authority: { _tag: 'Generated' },
        maximumScore: undefined,
        readOnly: false,
        blocked: false,
      },
      {
        authority: { _tag: 'Generated' },
        maximumScore: undefined,
        partial: true,
        readOnly: false,
        blocked: false,
      },
      {
        authority: { _tag: 'SourceEditable', maximumScore: 0 },
        maximumScore: 0,
        readOnly: false,
        blocked: false,
      },
      {
        authority: { _tag: 'SourceOnly' },
        maximumScore: 3,
        readOnly: true,
        blocked: true,
        message: i18n.t('driver.points.sourceOnly'),
      },
      {
        authority: { _tag: 'SourceEditable', maximumScore: 3 },
        maximumScore: undefined,
        readOnly: false,
        blocked: true,
        message: i18n.t('driver.points.sourceMaximum', { points: '3' }),
      },
      {
        authority: { _tag: 'SourceEditable', maximumScore: 3 },
        maximumScore: 3,
        preserveSourceXml: true,
        readOnly: true,
        blocked: false,
        message: i18n.t('driver.points.preserved'),
      },
      ...(['mode', 'xml'] as const).map((custom) => ({
        authority: { _tag: 'Generated' as const },
        maximumScore: 3,
        custom,
        readOnly: true,
        blocked: true,
        message: i18n.t('driver.points.custom'),
      })),
    ];
    for (const scenario of cases) {
      const draft: Draft = {
        type: scenario.partial ? 'multi_select' : 'single_select',
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Source scoring',
        bodyHtml: '<p>Choose Alpha.</p>',
        choices: [{ id: 'A', text: 'Alpha' }, { id: 'B', text: 'Beta' }],
        correctId: 'A',
        correctIds: ['A', 'B'],
        responseMode: scenario.custom === 'mode'
          ? 'custom'
          : scenario.partial
          ? 'partial'
          : 'all_or_nothing',
        customResponseProcessingXml: scenario.custom === 'xml'
          ? '<qti-response-processing/>'
          : undefined,
        maximumScore: scenario.maximumScore,
        preserveSourceXml: scenario.preserveSourceXml,
      };
      const html = renderToString(
        <I18nProvider payload={payload}>
          <ItemEditorProvider
            pointEditingAuthority={scenario.authority}
            persistence={{
              _tag: 'Assessment',
              save: () => Promise.resolve({ itemId: 'source', rev: 1, identifier: 'source' }),
            }}
            choiceRichText={false}
            payload={payload}
            playerCatalog={playerMessageCatalogForLocale(locale)}
            initialDraft={draft}
          >
            <Controls />
          </ItemEditorProvider>
        </I18nProvider>,
      );
      expect(/<input\b[^>]*\sreadonly(?:=|\s|>)/.test(html)).toStrictEqual(scenario.readOnly);
      expect(/<button\b[^>]*\sdisabled(?:=|\s|>)/.test(html), JSON.stringify(scenario))
        .toStrictEqual(scenario.blocked);
      if (scenario.authority._tag === 'Generated' && scenario.maximumScore === undefined) {
        expect(html).toContain(`value="${scenario.partial ? 2 : 1}"`);
      } else if (scenario.maximumScore === undefined) {
        expect(/<input\b[^>]*\svalue(?:=""|\s|\/>)/.test(html)).toStrictEqual(true);
      } else {
        expect(html).toContain(`value="${scenario.maximumScore}"`);
      }
      const knownScoring = scenario.authority._tag !== 'SourceOnly' &&
        !scenario.preserveSourceXml && !scenario.custom;
      expect(html.includes(
        i18n.t(scenario.partial ? 'driver.points.partial' : 'driver.points.matching'),
      )).toStrictEqual(knownScoring);
      expect(html.includes(i18n.t('driver.points.help'))).toStrictEqual(knownScoring);
      expect(/aria-describedby="[^"]*-help/.test(html)).toStrictEqual(knownScoring);
      if (scenario.message) expect(html).toContain(scenario.message);
    }
  });
}
