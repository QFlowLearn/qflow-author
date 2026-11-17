import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { I18nProvider } from '../lib/i18n/context.tsx';
import {
  type AssessmentBlueprintCoverage,
  parseAssessmentBlueprint,
  UNSPECIFIED_ASSESSMENT_BLUEPRINT,
} from '../lib/assessment_blueprint.ts';
import BlueprintPanel from '../islands/BlueprintPanel.tsx';
import BlueprintEditorFields, {
  createStarterBlueprintFormDraft,
} from '../islands/BlueprintEditorFields.tsx';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;

const blueprint = parseAssessmentBlueprint({
  _tag: 'Defined',
  version: 1,
  outcomes: [{ id: 'outcome-1', title: 'Authored <Outcome>', weight: 100 }],
  targets: [{
    id: 'target-1',
    outcomeId: 'outcome-1',
    count: 2,
    cognitiveDemand: 'understand',
    difficulty: 'medium',
    questionType: 'single_select',
  }],
});
const target = {
  id: 'target-1',
  outcomeId: 'outcome-1',
  count: 2,
  cognitiveDemand: 'understand' as const,
  difficulty: 'medium' as const,
  questionType: 'single_select' as const,
};

const coverage = {
  complete: false,
  expected: 2,
  assigned: 1,
  unassigned: 1,
  unknownTarget: 0,
  incompatibleQuestionType: 0,
  targets: [{
    ...target,
    outcomeTitle: 'Authored <Outcome>',
    actual: 1,
    remaining: 1,
    excess: 0,
  }],
} as AssessmentBlueprintCoverage;

for (const locale of locales) {
  testCase(`blueprint panel renders localized defined state in ${locale}`, () => {
    const catalog = catalogForLocale(locale);
    const payload = createI18nPayload(locale, catalog, ['imports']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = renderToString(
      <BlueprintPanel
        resource='assessment'
        resourceId='assessment-1'
        initialBlueprint={blueprint}
        coverage={coverage}
        readOnly
        payload={payload}
      />,
    );
    expect(html).toContain(i18n.t('imports.blueprint.title'));
    expect(html).toContain(i18n.t('imports.blueprint.outcomes'));
    expect(html).toContain(i18n.t('imports.blueprint.targets'));
    expect(html).toContain(i18n.t('imports.blueprint.coverageRatio', {
      assigned: 1,
      expected: 2,
    }));
    expect(html).toContain(i18n.t('imports.blueprint.incomplete'));
    expect(html).toContain('Authored &lt;Outcome>');
    expect(html).not.toMatch(/imports\.blueprint\./);
    expect(html).not.toMatch(/>single_select<|>understand<|>medium</);
  });

  testCase(`blueprint panel renders unspecified and complete states in ${locale}`, () => {
    const catalog = catalogForLocale(locale);
    const payload = createI18nPayload(locale, catalog, ['imports']);
    const i18n = createI18n(locale, payload.namespaces);
    const completeCoverage = { ...coverage, complete: true, assigned: 2, unassigned: 0 };
    const completeHtml = renderToString(
      <BlueprintPanel
        resource='assessment'
        resourceId='assessment-1'
        initialBlueprint={blueprint}
        coverage={completeCoverage}
        readOnly
        payload={payload}
      />,
    );
    expect(completeHtml).toContain(i18n.t('imports.blueprint.complete'));
    expect(completeHtml).toContain(i18n.t('imports.blueprint.coverageRatio', {
      assigned: 2,
      expected: 2,
    }));
    const unspecifiedHtml = renderToString(
      <BlueprintPanel
        resource='assessment'
        resourceId='assessment-1'
        initialBlueprint={UNSPECIFIED_ASSESSMENT_BLUEPRINT}
        readOnly
        payload={payload}
      />,
    );
    expect(unspecifiedHtml).toContain(i18n.t('imports.blueprint.noPlan'));
    const starter = createStarterBlueprintFormDraft(i18n);
    expect(starter.outcomes[0].title).toContain(i18n.t('imports.blueprint.primaryOutcome'));
    const editorHtml = renderToString(
      <I18nProvider payload={payload}>
        <BlueprintEditorFields
          value={starter}
          onChange={() => {}}
          allowedQuestionTypes={['single_select']}
        />
      </I18nProvider>,
    );
    expect(editorHtml).toContain(i18n.t('imports.blueprint.outcomeWeight', { value: 1 }));
    expect(editorHtml).toContain(i18n.t('imports.blueprint.plannedTotal', { count: 5 }));
    expect(editorHtml).toContain('value="single_select"');
    expect(editorHtml).toContain(i18n.t('imports.blueprint.typeLabel', { type: 'single_select' }));
  });
}
