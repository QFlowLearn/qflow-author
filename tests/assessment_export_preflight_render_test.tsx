import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';

import AssessmentExportPreflight from '../islands/assessment_builder/AssessmentExportPreflight.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { createI18n } from '../lib/i18n/messages.ts';

testCase('destination preflight idle render is localized for every locale', () => {
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
    const catalog = catalogForLocale(locale);
    const payload = createI18nPayload(locale, catalog, ['delivery', 'assessments']);
    const translator = createI18n(locale, payload.namespaces);
    const html = renderToString(
      <I18nProvider payload={payload}>
        <AssessmentExportPreflight
          assessmentId='assessment-1'
          revisionFingerprint='revision-1'
        />
      </I18nProvider>,
    );

    for (
      const key of [
        'delivery.preflight.title',
        'delivery.preflight.subtitle',
        'delivery.preflight.portability',
        'delivery.preflight.portabilityLink',
        'delivery.preflight.destination',
        'delivery.preflight.chooseDestination',
        'delivery.preflight.idle',
      ]
    ) expect(html).toContain(translator.t(key));
    if (html.includes('id="assessment-export"')) {
      expect.unreachable('Expected !html.includes(\'id="assessment-export"\')');
    }
    expect(html).toContain('id="assessment-export-target"');
    const targets = [
      ['canvas-classic', 'delivery.target.canvas-classic'],
      ['canvas-new-quizzes', 'delivery.target.canvas-new-quizzes'],
      ['blackboard-question-banks', 'delivery.target.blackboard-question-banks'],
      ['brightspace-course-import', 'delivery.target.brightspace-course-import'],
      ['moodle', 'delivery.target.moodle'],
      ['qti3-conformant', 'delivery.target.qti3-conformant'],
      ['qti22-standard', 'delivery.target.qti22-standard'],
      ['qti21-standard', 'delivery.target.qti21-standard'],
      ['qti12-standard', 'delivery.target.qti12-standard'],
      ['printable-pack', 'print.destination'],
    ] as const;
    for (const [value, key] of targets) {
      const optionText = translator.t(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(html).toMatch(new RegExp(`<option value="${value}">${optionText}</option>`));
    }
    expect(html).not.toContain('print.destination');
    if (html.includes('delivery.')) expect.unreachable("Expected !html.includes('delivery.')");
    if (html.includes('{count')) expect.unreachable("Expected !html.includes('{count')");
    if (html.includes('Hosted delivery')) {
      expect.unreachable("Expected !html.includes('Hosted delivery')");
    }
    if (html.includes('/api/assessments/assessment-1/package')) {
      expect.unreachable("Expected !html.includes('/api/assessments/assessment-1/package')");
    }
    if (locale.startsWith('es-')) {
      for (
        const phrase of [
          'Export assessment',
          'Printable assessment pack',
          'Check the saved assessment',
          'QFlowLearn does not charge',
          'Review the portability pledge',
          'Destination',
          'QFlowLearn runs the destination',
          'Choose a destination',
          'Learning platforms',
          'QTI packages',
          'Select a destination',
          'Canvas Classic Quizzes',
          'Canvas New Quizzes',
          'Brightspace course import',
          'standard package',
          'question banks',
        ]
      ) if (html.includes(phrase)) expect.unreachable('Expected !html.includes(phrase)');
    }
  }
});
