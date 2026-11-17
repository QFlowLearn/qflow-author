import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { resolveStorage } from '../../../storage.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { prepareBankRelease } from '../../../services/bank_release_preparation.ts';
import { releaseFailureStatus } from '../../../services/bank_release_preview.ts';
const methods = {
  async POST(ctx) {
    const form = await ctx.req.formData();
    if (
      [...form.keys()].length !== 3 ||
      ['version', 'digest', 'preparationId'].some((key) =>
        form.getAll(key).length !== 1 || typeof form.get(key) !== 'string'
      )
    ) return new Response(ctx.state.i18n.t('releases.error.invalid_input'), { status: 400 });
    const result = await prepareBankRelease(requireAuthContext(ctx.state), {
      releaseId: ctx.params.id,
      version: Number(form.get('version')),
      digest: String(form.get('digest')),
      preparationId: String(form.get('preparationId')),
    }, { storage: resolveStorage(ctx) });
    if (!result.ok) {
      return new Response(ctx.state.i18n.t(`releases.error.${result.code}`), {
        status: releaseFailureStatus(result.code),
      });
    }
    return new Response(null, { status: 303, headers: { location: `/releases/${result.value}` } });
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const releasePreparePageRoute = defineHttpRoute('/releases/:id/prepare', { ...methods });
