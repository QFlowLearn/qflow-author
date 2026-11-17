import Button from '../../../../components/ui/Button.tsx';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import type { I18n } from '../../../i18n/messages.ts';

const commitments = [
  {
    title: 'help.portability.commitmentOwnership',
    detail: 'help.portability.commitmentOwnershipDetail',
  },
  {
    title: 'help.portability.commitmentFee',
    detail: 'help.portability.commitmentFeeDetail',
  },
  {
    title: 'help.portability.commitmentAi',
    detail: 'help.portability.commitmentAiDetail',
  },
  {
    title: 'help.portability.commitmentLoss',
    detail: 'help.portability.commitmentLossDetail',
  },
  {
    title: 'help.portability.commitmentQti',
    detail: 'help.portability.commitmentQtiDetail',
  },
] as const;

const paidCapabilities = [
  'help.portability.paidAi',
  'help.portability.paidBulk',
  'help.portability.paidReview',
  'help.portability.paidIntegrations',
] as const;

/** Shared route contract preserving the existing server-rendered page behavior. */
export const portabilityPageRoute = defineHttpRoute('/help/portability', {
  GET: handleGET,
  HEAD: handleGET,
});

export default function PortabilityPledge({ i18n }: { i18n: I18n }) {
  return (
    <section class='max-w-5xl space-y-8'>
      <header class='flex flex-wrap items-start justify-between gap-4'>
        <div class='space-y-2'>
          <h1 class='text-3xl font-medium'>{i18n.t('help.portability.title')}</h1>
          <p class='max-w-2xl text-sm leading-6 text-base-content/70'>
            {i18n.t('help.portability.subtitle')}
          </p>
        </div>
        <Button href='/assessments/new?intent=recover' variant='primary'>
          {i18n.t('help.qti3.bringFiles')}
        </Button>
      </header>

      <section class='border-y border-base-300'>
        <h2 class='sr-only'>{i18n.t('help.portability.commitments')}</h2>
        <dl class='divide-y divide-base-300'>
          {commitments.map((commitment) => (
            <div
              key={commitment.title}
              class='grid gap-2 py-5 sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-6'
            >
              <dt class='font-medium text-base-content'>{i18n.t(commitment.title)}</dt>
              <dd class='max-w-3xl text-sm leading-6 text-base-content/70'>
                {i18n.t(commitment.detail)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section class='grid gap-6 border-b border-base-300 pb-8 lg:grid-cols-2'>
        <div class='space-y-3'>
          <h2 class='text-xl font-medium'>{i18n.t('help.portability.charges')}</h2>
          <p class='text-sm leading-6 text-base-content/70'>
            {i18n.t('help.portability.chargesDetail')}
          </p>
        </div>
        <ul class='list-disc space-y-2 pl-5 text-sm leading-6 text-base-content/75'>
          {paidCapabilities.map((capability) => <li key={capability}>{i18n.t(capability)}</li>)}
        </ul>
      </section>

      <section class='flex flex-wrap items-center justify-between gap-5 rounded-lg bg-base-200/60 p-5 sm:p-6'>
        <div class='max-w-2xl space-y-2'>
          <h2 class='text-xl font-medium'>{i18n.t('help.portability.terms')}</h2>
          <p class='text-sm leading-6 text-base-content/70'>
            {i18n.t('help.portability.termsDetail')}
          </p>
        </div>
        <Button href='https://www.qflowlearn.com/terms/portability'>
          {i18n.t('help.portability.readTerms')}
        </Button>
      </section>
    </section>
  );
}

function handleGET(ctx: HttpRequest) {
  return ctx.render(<PortabilityPledge i18n={ctx.state.i18n} />);
}
