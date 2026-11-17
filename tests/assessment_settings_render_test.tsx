import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import AssessmentWorkspace from '../components/ui/AssessmentWorkspace.tsx';
import AssessmentSettingsPanel from '../islands/assessment_builder/AssessmentSettingsPanel.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { adaptiveExportFixture } from './helpers/adaptive_export_fixture.ts';

testCase(
  'assessment settings expose a stable disclosure target before deferred loading in every locale',
  () => {
    for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
      const catalog = catalogForLocale(locale);
      const i18n = createI18n(locale, catalog);
      const html = render(
        <I18nProvider payload={createI18nPayload(locale, catalog, ['assessments'])}>
          <AssessmentWorkspace
            assessment={{ id: 'assessment-1', title: 'Title' }}
            assessmentPlanLabel='Plan'
            settingsOpen={false}
            onOpenSettings={() => {}}
          />
        </I18nProvider>,
      );
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain('aria-controls="assessment-settings-panel"');
      expect(html).toContain('id="assessment-settings-panel"');
      expect(html).toContain(i18n.t('assessments.settings.title'));
    }
  },
);

testCase(
  'adaptive settings identify canvas ownership and omit manual order and part editing',
  () => {
    const fixture = adaptiveExportFixture();
    for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
      const catalog = catalogForLocale(locale);
      const i18n = createI18n(locale, catalog);
      const html = render(
        <I18nProvider payload={createI18nPayload(locale, catalog, ['assessments'])}>
          <AssessmentSettingsPanel
            items={{}}
            open
            assessment={{ ...fixture.assessment, adaptivePlan: fixture.plan }}
            parts={[fixture.part]}
            captureOrder={() => {
              throw new Error('Rendering must not initiate a settings write');
            }}
            returnFocusRef={{ current: null }}
            onClose={() => {}}
            onBlockedChange={() => {}}
            guardQuestionDraft={() => Promise.resolve(true)}
            questionPointDefault={null}
            onQuestionPointDefaultConfirmed={() => {
              throw new Error('Rendering must not change a confirmed point default');
            }}
          />
        </I18nProvider>,
      );
      expect(html).toContain(i18n.t('assessments.settings.adaptive'));
      expect(html).toContain(i18n.t('assessments.settings.publishFirst'));
      if (html.includes(i18n.t('assessments.settings.arrange'))) {
        expect.unreachable("Expected !html.includes(i18n.t('assessments.settings.arrange'))");
      }
      if (html.includes(i18n.t('assessments.settings.save'))) {
        expect.unreachable("Expected !html.includes(i18n.t('assessments.settings.save'))");
      }
      if (html.includes(i18n.t('assessments.questionDefaults.points'))) {
        expect.unreachable(
          "Expected !html.includes(i18n.t('assessments.questionDefaults.points'))",
        );
      }
      if (html.includes('href="https://')) {
        expect.unreachable("Expected !html.includes('href=\"https://')");
      }
    }
  },
);
