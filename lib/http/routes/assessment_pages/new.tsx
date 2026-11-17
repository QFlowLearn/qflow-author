import { mountIsland } from '../../../rendering/mount_island.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import BringFilesIntakeView from '../../../../islands/BringFilesIntake.tsx';
import { saveAssessment } from '../../../services/assessment_records.ts';
import {
  parseSourceIntakeEntryContext,
  type SourceIntakeEntryContext,
} from '../../../source_intake/entry_context.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../../../assessment_blueprint.ts';
import { createI18nPayload } from '../../../i18n/payload.ts';

const methods = {
  GET(ctx) {
    const parsed = parseSourceIntakeEntryContext(ctx.url.searchParams, { _tag: 'Assessment' });
    if (!parsed.ok) {
      return new Response(ctx.state.i18n.t('imports.intake.invalidEntry'), { status: 400 });
    }
    return ctx.render(
      <NewAssessmentPage
        {...parsed.context}
        i18n={ctx.state.i18n}
        payload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, [
          'imports',
          'assessments',
        ])}
      />,
    );
  },
  async POST(ctx) {
    const auth = requireAuthContext(ctx.state);
    const created = await saveAssessment(auth, {
      title: ctx.state.i18n.t('imports.intake.defaultAssessmentTitle'),
      brief: '',
      gradeLevel: '',
      targetCount: 0,
      attachmentId: null,
      blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
      metadata: {
        ai: {
          status: 'planned',
          difficulty: 'medium',
          types: ['single_select', 'text_entry'],
        },
      },
      parts: [{
        title: ctx.state.i18n.t('imports.intake.defaultPartTitle', { number: 1 }),
        placements: [],
      }],
    });

    if (created._tag === 'Rejected') {
      const status = created.code === 'forbidden'
        ? 403
        : created.code === 'assessment_not_found'
        ? 404
        : 409;
      return new Response(created.code, { status });
    }

    return new Response(null, {
      status: 303,
      headers: { location: `/assessments/${created.id}` },
    });
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const assessmentNewPageRoute = defineHttpRoute('/assessments/new', {
  ...methods,
  HEAD: methods.GET,
});

export default function NewAssessmentPage(
  { initialPurpose, entrySource, destination, i18n, payload }: SourceIntakeEntryContext & {
    i18n: import('../../../i18n/messages.ts').I18n;
    payload: import('../../../i18n/payload.ts').I18nPayload;
  },
) {
  const isRespondusEntry = entrySource === 'respondus';
  return (
    <section class='mx-auto max-w-6xl space-y-6'>
      <header class='space-y-2'>
        <p class='qf-label text-sm uppercase text-secondary'>
          {isRespondusEntry
            ? i18n.t('imports.intake.respondusEyebrow')
            : i18n.t('imports.intake.normalEyebrow')}
        </p>
        <h1 class='text-3xl font-semibold tracking-tight sm:text-4xl'>
          {isRespondusEntry
            ? i18n.t('imports.intake.respondusTitle')
            : i18n.t('imports.intake.normalTitle')}
        </h1>
        <p class='max-w-3xl text-base leading-7 text-base-content/70'>
          {isRespondusEntry
            ? i18n.t('imports.intake.respondusDescription')
            : i18n.t('imports.intake.normalDescription')}
        </p>
      </header>
      <BringFilesIntake
        destination={destination}
        initialPurpose={initialPurpose}
        entrySource={entrySource}
        payload={payload}
      />
    </section>
  );
}

const BringFilesIntake = mountIsland({ component: 'BringFilesIntake', View: BringFilesIntakeView });
