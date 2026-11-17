import Button from '../../../../components/ui/Button.tsx';
import Input from '../../../../components/ui/Input.tsx';
import Select from '../../../../components/ui/Select.tsx';
import { createDraftSessionId, parseDraftSessionId } from '../../../draft_session_id.ts';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requestErrorResponse } from '../../request_error_response.ts';
import { canStartBankIntake } from '../../../services/bank_intake_access.ts';
import { createBankDraft } from '../../../services/bank_drafts.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { isQuestionTypeId, QUESTION_TYPES } from '../../../types/registry.ts';
import { isCanonicalUuid } from '../../../uuid.ts';

const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    const collectionId = ctx.url.searchParams.get('collection');
    if (
      ctx.url.searchParams.getAll('collection').length > 1 ||
      (collectionId !== null && !isCanonicalUuid(collectionId))
    ) return new Response(null, { status: 400 });
    if (!await canStartBankIntake(auth, collectionId)) {
      return requestErrorResponse(ctx.state.i18n, 'not_found', 404);
    }
    const i18n = ctx.state.i18n;
    return ctx.render(
      <section class='max-w-xl space-y-5'>
        <h1 class='text-3xl font-medium'>{i18n.t('items.drafts.create')}</h1>
        <p>{i18n.t('items.drafts.createHelp')}</p>
        <form method='post' class='space-y-4'>
          <Input type='hidden' name='id' value={createDraftSessionId()} />
          {collectionId !== null && (
            <Input
              type='hidden'
              name='collectionId'
              value={collectionId}
            />
          )}
          <label class='ds-form-control gap-1'>
            <span>{i18n.t('items.drafts.type')}</span>
            <Select name='type' defaultValue='single_select'>
              {QUESTION_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {i18n.t('assessments.builder.questionTypeLabel', { type: type.id })}
                </option>
              ))}
            </Select>
          </label>
          <Button type='submit' variant='primary'>{i18n.t('items.drafts.start')}</Button>
          <Button href='/items' variant='ghost'>{i18n.t('items.drafts.back')}</Button>
        </form>
        <Button href='/items/drafts' variant='text'>{i18n.t('items.drafts.title')}</Button>
      </section>,
    );
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const id = parseDraftSessionId(form.get('id'));
    const type = form.get('type');
    const collectionId = form.get('collectionId');
    const exact = [...form.keys()].every((key) => ['id', 'type', 'collectionId'].includes(key)) &&
      form.getAll('id').length === 1 && form.getAll('type').length === 1 &&
      form.getAll('collectionId').length <= 1;
    if (
      !exact || !id || !isQuestionTypeId(type) ||
      (collectionId !== null && !isCanonicalUuid(collectionId))
    ) return new Response(ctx.state.i18n.t('items.drafts.invalid'), { status: 400 });
    const result = await createBankDraft(requireAuthContext(ctx.state), { id, type, collectionId });
    if (!result.ok) {
      return new Response(ctx.state.i18n.t('items.drafts.unavailable'), {
        status: result.code === 'forbidden' ? 403 : 409,
      });
    }
    return new Response(null, { status: 303, headers: { location: `/items/drafts/${result.id}` } });
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const bankNewPageRoute = defineHttpRoute('/items/new', { ...methods, HEAD: methods.GET });
