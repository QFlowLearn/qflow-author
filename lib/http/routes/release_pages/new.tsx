import { defineHttpRoute, type HttpHandler, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { loadReleaseCreationOptions } from '../../../services/bank_release_selection.ts';
import { createBankRelease } from '../../../services/bank_releases.ts';
import { parseReleaseCreateForm } from '../../../banks/bank_release_http.ts';
import { uuidList } from '../../../banks/bank_release.ts';
import { releaseFailureStatus } from '../../../services/bank_release_preview.ts';
import Button from '../../../../components/ui/Button.tsx';
import Input from '../../../../components/ui/Input.tsx';
import Textarea from '../../../../components/ui/Textarea.tsx';
import Checkbox from '../../../../components/ui/Checkbox.tsx';
const methods = {
  GET(ctx) {
    return renderSelection(ctx, []);
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    if (form.get('action') === 'select') {
      const ids = form.getAll('questionId');
      if (!uuidList(ids) || !ids.length) {
        return new Response(ctx.state.i18n.t('releases.error.invalid_selection'), { status: 400 });
      }
      return renderSelection(ctx, ids);
    }
    const input = parseReleaseCreateForm(form);
    if (!input) {
      return new Response(ctx.state.i18n.t('releases.error.invalid_input'), { status: 400 });
    }
    const result = await createBankRelease(requireAuthContext(ctx.state), input);
    if (!result.ok) {
      return new Response(ctx.state.i18n.t(`releases.error.${result.code}`), {
        status: releaseFailureStatus(result.code),
      });
    }
    return new Response(null, { status: 303, headers: { location: `/releases/${result.value}` } });
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const releaseNewPageRoute = defineHttpRoute('/releases/new', {
  ...methods,
  HEAD: methods.GET,
});
async function renderSelection(ctx: HttpRequest, questionIds: readonly string[]) {
  const auth = requireAuthContext(ctx.state), i18n = ctx.state.i18n;
  const options = await loadReleaseCreationOptions(auth);
  if (!options.ok) {
    return ctx.render(
      <section class='space-y-3'>
        <h1>{i18n.t('releases.create')}</h1>
        <p>{i18n.t('releases.grantRequired')}</p>
        <Button href='/settings/members'>{i18n.t('settings.members.title')}</Button>
      </section>,
      403,
    );
  }
  const collections = options.value;
  return ctx.render(
    <section class='space-y-5 max-w-2xl'>
      <a class='link' href='/releases'>{i18n.t('releases.title')}</a>
      <h1 class='text-3xl font-medium'>{i18n.t('releases.create')}</h1>
      <p>{i18n.t('releases.visibility')}</p>
      <form method='post' action='/releases/new' class='space-y-4'>
        <Input type='hidden' name='id' value={crypto.randomUUID()} />
        <Input type='hidden' name='operationId' value={crypto.randomUUID()} />
        {questionIds.map((id) => <Input type='hidden' name='questionId' value={id} key={id} />)}
        <label class='block'>
          {i18n.t('releases.label')}
          <Input name='label' required maxLength={160} />
        </label>
        <label class='block'>
          {i18n.t('releases.notes')}
          <Textarea name='notes' maxLength={4000} />
        </label>
        {questionIds.length > 0 && (
          <p>{i18n.t('releases.selected', { count: questionIds.length })}</p>
        )}
        <fieldset class='space-y-2'>
          <legend class='font-medium'>{i18n.t('releases.collections')}</legend>
          {collections.map((row) => (
            <label key={row.id} class='flex items-center gap-3'>
              <Checkbox name='collectionId' value={row.id} />
              <span>{row.name}</span>
            </label>
          ))}
        </fieldset>
        <p>{i18n.t('releases.selectionHelp')}</p>
        <Button href='/items' variant='ghost'>{i18n.t('releases.selectQuestions')}</Button>
        <Button type='submit' variant='primary'>{i18n.t('releases.create')}</Button>
      </form>
    </section>,
  );
}
