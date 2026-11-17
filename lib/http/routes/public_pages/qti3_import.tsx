import Button from '../../../../components/ui/Button.tsx';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import type { I18n } from '../../../i18n/messages.ts';

/** Shared route contract preserving the existing server-rendered page behavior. */
export const qti3ImportPageRoute = defineHttpRoute('/help/qti3-import', {
  GET: handleGET,
  HEAD: handleGET,
});

export default function Qti3ImportRequirements({ i18n }: { i18n: I18n }) {
  return (
    <section class='max-w-5xl space-y-8'>
      <header class='flex flex-wrap items-start justify-between gap-4'>
        <div class='space-y-2'>
          <h1 class='text-3xl font-medium'>{i18n.t('help.qti3.title')}</h1>
          <p class='max-w-2xl text-sm leading-6 text-base-content/70'>
            {i18n.t('help.qti3.subtitle')}
          </p>
        </div>
        <div class='flex flex-wrap gap-2'>
          <Button href='/help/qti-fidelity'>{i18n.t('help.qti3.compatibility')}</Button>
          <Button href='/assessments/new?intent=recover' variant='primary'>
            {i18n.t('help.qti3.bringFiles')}
          </Button>
        </div>
      </header>

      <div class='grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(17rem,0.75fr)]'>
        <div class='space-y-8'>
          <section class='space-y-4'>
            <h2 class='text-xl font-medium'>{i18n.t('help.qti3.basics')}</h2>
            <ul class='list-disc space-y-3 pl-5 text-sm leading-6 text-base-content/80'>
              <li>
                {i18n.t('help.qti3.zipPrefix')} <code class='rounded bg-base-200 px-1'>.zip</code>
                {' '}
                {i18n.t('help.qti3.zipSuffix')}
              </li>
              <li>
                {i18n.t('help.qti3.manifestPrefix')}{' '}
                <code class='rounded bg-base-200 px-1'>imsmanifest.xml</code>{' '}
                {i18n.t('help.qti3.manifestSuffix')}
              </li>
              <li>
                {i18n.t('help.qti3.assetsPrefix')}{' '}
                <code class='rounded bg-base-200 px-1'>&lt;file&gt;</code>{' '}
                {i18n.t('help.qti3.assetsSuffix')}
              </li>
              <li>
                {i18n.t('help.qti3.pathsPrefix')}{' '}
                <code class='rounded bg-base-200 px-1'>assets/diagram.svg</code>
                {i18n.t('help.qti3.pathsSuffix')}
              </li>
            </ul>
          </section>

          <section class='space-y-4 border-t border-base-300 pt-7'>
            <h2 class='text-xl font-medium'>{i18n.t('help.qti3.types')}</h2>
            <p class='text-sm text-base-content/70'>
              {i18n.t('help.qti3.typesHelp')}
            </p>
            <ul class='grid list-disc gap-x-8 gap-y-2 pl-5 text-sm leading-6 text-base-content/80 sm:grid-cols-2'>
              {[
                'choice',
                'text',
                'inline',
                'order',
                'gap',
                'hottext',
                'slider',
                'graphic',
                'position',
                'media',
                'upload',
                'drawing',
                'pci',
                'custom',
                'end',
              ].map((key) => <li key={key}>{i18n.t(`help.qti3.interaction.${key}`)}</li>)}
            </ul>
          </section>
        </div>

        <aside class='space-y-5 rounded-lg border border-base-300 bg-base-100 p-5 lg:self-start'>
          <div class='space-y-2'>
            <h2 class='text-lg font-medium'>{i18n.t('help.qti3.troubleshooting')}</h2>
            <p class='text-sm leading-6 text-base-content/65'>
              {i18n.t('help.qti3.troubleshootingHelp')}
            </p>
          </div>
          <ul class='list-disc space-y-3 pl-5 text-sm leading-6 text-base-content/80'>
            <li>{i18n.t('help.qti3.problem.manifest')}</li>
            <li>{i18n.t('help.qti3.problem.files')}</li>
            <li>{i18n.t('help.qti3.problem.interactions')}</li>
          </ul>
          <Button href='/assessments/new?intent=recover' variant='primary'>
            {i18n.t('help.qti3.bringFiles')}
          </Button>
        </aside>
      </div>
    </section>
  );
}

function handleGET(ctx: HttpRequest) {
  return ctx.render(<Qti3ImportRequirements i18n={ctx.state.i18n} />);
}
