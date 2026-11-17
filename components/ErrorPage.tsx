import type { I18n } from '../lib/i18n/messages.ts';
import Button from '../components/ui/Button.tsx';

export default function ErrorPage({ state }: { state: { readonly i18n: I18n } }) {
  return (
    <section class='space-y-4' role='alert'>
      <h1 class='text-3xl font-medium'>{state.i18n.t('help.page.error.title')}</h1>
      <p class='text-base-content/70'>{state.i18n.t('help.page.error.description')}</p>
      <Button href='/assessments'>{state.i18n.t('help.page.back')}</Button>
    </section>
  );
}
