import Button from '../../../../components/ui/Button.tsx';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import type { I18n } from '../../../i18n/messages.ts';

const rows = [
  {
    standard: 'QTI 1.2 / 1.2.1',
    support: 'help.fidelity.imports',
    handling: 'help.fidelity.qti12',
  },
  {
    standard: 'QTI 2.0 / 2.1 / 2.2',
    support: 'help.fidelity.imports',
    handling: 'help.fidelity.qti2',
  },
  {
    standard: 'QTI 3.0',
    support: 'help.fidelity.importsExports',
    handling: 'help.fidelity.qti3',
  },
];

const categories = [
  {
    label: 'help.fidelity.imported',
    detail: 'help.fidelity.importedDetail',
  },
  {
    label: 'help.fidelity.converted',
    detail: 'help.fidelity.convertedDetail',
  },
  {
    label: 'help.fidelity.needsReview',
    detail: 'help.fidelity.needsReviewDetail',
  },
  {
    label: 'help.fidelity.sourcePreserved',
    detail: 'help.fidelity.sourcePreservedDetail',
  },
];

const workflowSteps = [
  {
    title: 'help.fidelity.stepImport',
    detail: 'help.fidelity.stepImportDetail',
  },
  {
    title: 'help.fidelity.stepSummary',
    detail: 'help.fidelity.stepSummaryDetail',
  },
  {
    title: 'help.fidelity.stepReview',
    detail: 'help.fidelity.stepReviewDetail',
  },
  {
    title: 'help.fidelity.stepCreate',
    detail: 'help.fidelity.stepCreateDetail',
  },
];

const warningGuidance = [
  {
    label: 'help.fidelity.warningTask',
    detail: 'help.fidelity.warningTaskDetail',
  },
  {
    label: 'help.fidelity.sourceAvailable',
    detail: 'help.fidelity.sourceAvailableDetail',
  },
  {
    label: 'help.fidelity.reportConversions',
    detail: 'help.fidelity.reportConversionsDetail',
  },
];

/** Shared route contract preserving the existing server-rendered page behavior. */
export const qtiFidelityPageRoute = defineHttpRoute('/help/qti-fidelity', {
  GET: handleGET,
  HEAD: handleGET,
});

export default function QtiFidelity({ i18n }: { i18n: I18n }) {
  return (
    <section class='max-w-5xl space-y-8'>
      <header class='flex flex-wrap items-start justify-between gap-4'>
        <div class='space-y-2'>
          <h1 class='text-3xl font-medium'>{i18n.t('help.fidelity.title')}</h1>
          <p class='max-w-2xl text-sm leading-6 text-base-content/70'>
            {i18n.t('help.fidelity.subtitle')}
          </p>
        </div>
        <div class='flex flex-wrap gap-2'>
          <Button href='/help/qti-sample-report'>{i18n.t('help.fidelity.sample')}</Button>
          <Button href='/assessments/new?intent=recover' variant='primary'>
            {i18n.t('help.qti3.bringFiles')}
          </Button>
        </div>
      </header>

      <section class='rounded-lg border border-base-300 bg-base-100 p-5 sm:p-6'>
        <h2 class='text-xl font-medium'>{i18n.t('help.fidelity.preserves')}</h2>
        <p class='mt-3 max-w-3xl text-sm leading-6 text-base-content/75'>
          {i18n.t('help.fidelity.preservesDetail')}
        </p>
      </section>

      <section class='grid gap-5 border-t border-base-300 pt-7 lg:grid-cols-[15rem_minmax(0,1fr)]'>
        <div class='space-y-2'>
          <h2 class='text-xl font-medium'>{i18n.t('help.fidelity.useReport')}</h2>
          <p class='text-sm leading-6 text-base-content/65'>
            {i18n.t('help.fidelity.useReportDetail')}
          </p>
        </div>
        <ol class='grid gap-x-6 gap-y-5 sm:grid-cols-2'>
          {workflowSteps.map((step, index) => (
            <li key={step.title} class='grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3'>
              <span
                class='inline-grid size-7 place-items-center rounded-full bg-base-200 text-xs font-medium text-base-content/70'
                aria-hidden='true'
              >
                {index + 1}
              </span>
              <div class='space-y-1'>
                <h3 class='text-base font-medium'>{i18n.t(step.title)}</h3>
                <p class='text-sm leading-6 text-base-content/70'>
                  {i18n.t(step.detail)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section class='space-y-4 border-t border-base-300 pt-7'>
        <h2 class='text-xl font-medium'>{i18n.t('help.fidelity.standards')}</h2>
        <div class='overflow-x-auto'>
          <table class='ds-table w-full text-sm'>
            <thead>
              <tr>
                <th>{i18n.t('help.fidelity.standard')}</th>
                <th>{i18n.t('help.fidelity.support')}</th>
                <th>{i18n.t('help.fidelity.expect')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.standard}>
                  <td>{row.standard}</td>
                  <td>{i18n.t(row.support)}</td>
                  <td class='max-w-xl'>{i18n.t(row.handling)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class='space-y-4 border-t border-base-300 pt-7'>
        <h2 class='text-xl font-medium'>{i18n.t('help.fidelity.labels')}</h2>
        <dl class='divide-y divide-base-200 rounded-lg border border-base-300'>
          {categories.map((category) => (
            <div
              key={category.label}
              class='grid gap-1 px-4 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-5'
            >
              <dt class='font-medium'>{i18n.t(category.label)}</dt>
              <dd class='text-sm leading-6 text-base-content/70'>
                {i18n.t(category.detail)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section class='space-y-4 border-t border-base-300 pt-7'>
        <h2 class='text-xl font-medium'>{i18n.t('help.fidelity.readWarnings')}</h2>
        <div class='grid gap-4 md:grid-cols-3'>
          {warningGuidance.map((item) => (
            <div key={item.label} class='space-y-2'>
              <h3 class='text-lg font-medium'>{i18n.t(item.label)}</h3>
              <p class='text-sm leading-6 text-base-content/70'>
                {i18n.t(item.detail)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section class='flex flex-wrap items-center justify-between gap-5 rounded-lg bg-base-200/50 p-5 sm:p-6'>
        <div class='max-w-2xl space-y-2'>
          <h2 class='text-xl font-medium'>{i18n.t('help.fidelity.report')}</h2>
          <p class='text-sm leading-6 text-base-content/75'>
            {i18n.t('help.fidelity.reportDetail')}
          </p>
        </div>
        <div class='flex flex-wrap gap-2'>
          <Button href='/help/qti-sample-report'>{i18n.t('help.fidelity.sample')}</Button>
          <Button href='/imports' variant='ghost'>{i18n.t('help.fidelity.viewRuns')}</Button>
        </div>
      </section>
    </section>
  );
}

function handleGET(ctx: HttpRequest) {
  return ctx.render(<QtiFidelity i18n={ctx.state.i18n} />);
}
