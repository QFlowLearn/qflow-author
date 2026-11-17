import Button from '../../../../components/ui/Button.tsx';
import { ensureDemoPresidents } from '../../../demo_presidents_seed.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';

/** Shared route contract preserving the existing server-rendered page behavior. */
export const onboardingPageRoute = defineHttpRoute('/onboarding', {
  GET: handleGET,
  HEAD: handleGET,
  POST: handlePOST,
});

export default function OnboardingPage(
  { i18n, error = false }: { i18n: import('../../../i18n/messages.ts').I18n; error?: boolean },
) {
  return (
    <section class='space-y-6'>
      <div class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('help.onboarding.title')}</h1>
        <p class='text-sm text-base-content/70'>
          {i18n.t('help.onboarding.subtitle')}
        </p>
      </div>
      {error && <p role='alert'>{i18n.t('help.onboarding.unknownAction')}</p>}
      <form class='ds-card ds-card-bordered max-w-2xl' method='post'>
        <div class='ds-card-body space-y-4'>
          <div class='rounded-lg border border-base-200 p-4'>
            <h2 class='text-lg font-medium'>{i18n.t('help.onboarding.demo.title')}</h2>
            <p class='text-sm text-base-content/70'>
              {i18n.t('help.onboarding.demo.description')}
            </p>
            <div class='mt-3'>
              <Button variant='primary' type='submit' name='action' value='demo'>
                {i18n.t('help.onboarding.demo.action')}
              </Button>
            </div>
          </div>
          <div class='rounded-lg border border-base-200 p-4'>
            <h2 class='text-lg font-medium'>{i18n.t('help.onboarding.blank.title')}</h2>
            <p class='text-sm text-base-content/70'>
              {i18n.t('help.onboarding.blank.description')}
            </p>
            <div class='mt-3'>
              <Button type='submit' name='action' value='blank'>
                {i18n.t('help.onboarding.blank.action')}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}

function handleGET(ctx: HttpRequest) {
  return ctx.render(<OnboardingPage i18n={ctx.state.i18n} />);
}

async function handlePOST(ctx: HttpRequest) {
  const form = await ctx.req.formData();
  const action = String(form.get('action') ?? '');
  if (action === 'demo') {
    const auth = requireAuthContext(ctx.state);
    const id = await ensureDemoPresidents(auth);
    return new Response(null, { status: 302, headers: { location: `/assessments/${id}` } });
  }
  if (action === 'blank') {
    return new Response(null, { status: 307, headers: { location: '/assessments/new' } });
  }
  return ctx.render(<OnboardingPage i18n={ctx.state.i18n} error />, 400);
}
