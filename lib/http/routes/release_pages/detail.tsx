import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { resolveStorage } from '../../../storage.ts';
import { getBankRelease, mutateBankRelease } from '../../../services/bank_releases.ts';
import {
  loadReleasePreview,
  parseReleasePreviewQuery,
  releaseFailureStatus,
} from '../../../services/bank_release_preview.ts';
import { parseReleaseMutationForm } from '../../../banks/bank_release_http.ts';
import ReleasePage from '../../../../components/releases/ReleasePage.tsx';
import Button from '../../../../components/ui/Button.tsx';
const methods = {
  async GET(ctx) {
    const query = parseReleasePreviewQuery(ctx.url.searchParams);
    if (!query) {
      return new Response(ctx.state.i18n.t('releases.error.invalid_input'), { status: 400 });
    }
    const result = await loadReleasePreview(
      requireAuthContext(ctx.state),
      ctx.params.id,
      query,
    );
    if (!result.ok) {
      return ctx.render(
        <section class='space-y-3'>
          <p role='alert'>{ctx.state.i18n.t(`releases.error.${result.code}`)}</p>
          <Button href={`/releases/${ctx.params.id}`}>{ctx.state.i18n.t('releases.reload')}</Button>
        </section>,
        releaseFailureStatus(result.code),
      );
    }
    return ctx.render(<ReleasePage data={result.value} i18n={ctx.state.i18n} />);
  },
  async POST(ctx) {
    const auth = requireAuthContext(ctx.state);
    const row = await getBankRelease(auth, ctx.params.id);
    if (!row.ok) {
      return new Response(ctx.state.i18n.t(`releases.error.${row.code}`), {
        status: releaseFailureStatus(row.code),
      });
    }
    const command = parseReleaseMutationForm(
      await ctx.req.formData(),
      ctx.params.id,
      row.value.manifest,
    );
    if (!command) {
      return new Response(ctx.state.i18n.t('releases.error.invalid_input'), { status: 400 });
    }
    const result = await mutateBankRelease(auth, command, {
      storage: resolveStorage(ctx),
    });
    if (!result.ok) {
      return ctx.render(
        <section class='space-y-3'>
          <p role='alert'>{ctx.state.i18n.t(`releases.error.${result.code}`)}</p>
          <Button href={`/releases/${ctx.params.id}`}>{ctx.state.i18n.t('releases.reload')}</Button>
        </section>,
        releaseFailureStatus(result.code),
      );
    }
    return new Response(null, { status: 303, headers: { location: `/releases/${result.value}` } });
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const releaseDetailPageRoute = defineHttpRoute('/releases/:id', {
  ...methods,
  HEAD: methods.GET,
});
