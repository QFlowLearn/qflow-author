import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { resolveStorage } from '../../../storage.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { downloadReleaseSource } from '../../../services/bank_release_preparation.ts';
import { releaseFailureStatus } from '../../../services/bank_release_preview.ts';
const methods = {
  async POST(ctx) {
    const form = await ctx.req.formData();
    if (
      [...form.keys()].length !== 1 || typeof form.get('operationId') !== 'string'
    ) return new Response(ctx.state.i18n.t('releases.error.invalid_input'), { status: 400 });
    const result = await downloadReleaseSource(
      requireAuthContext(ctx.state),
      ctx.params.id,
      String(form.get('operationId')),
      { storage: resolveStorage(ctx) },
    );
    if (!result.ok) {
      return new Response(ctx.state.i18n.t(`releases.error.${result.code}`), {
        status: releaseFailureStatus(result.code),
      });
    }
    return new Response(new Uint8Array(result.value.bytes), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="edition-${ctx.params.id}-source.zip"`,
        'cache-control': 'private, no-store',
        'etag': `"${result.value.sha256}"`,
      },
    });
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const releaseSourcePageRoute = defineHttpRoute('/releases/:id/source', { ...methods });
