import { mountIsland } from '../rendering/mount_island.ts';
import { readOrganizationReport } from '../services/question_organization_report.ts';
import { buildOrganizationReport } from '../question_organization_report.ts';
import { attachmentContentDisposition } from './attachment_content_disposition.ts';
import type { HttpRequest } from './route.ts';
import { requireAuthContext } from '../tenants.ts';
import { getDb } from '../db.ts';
import { QuestionOrganizationWorkspace } from '../services/question_organization_workspace.ts';
import { requestErrorResponse } from '../http/request_error_response.ts';
import { createI18nPayload } from '../i18n/payload.ts';
import { BankEnrichmentLayout } from '../../components/item_bank/BankEnrichmentLayout.tsx';
import QuestionOrganizationProgressView from '../../islands/QuestionOrganizationProgress.tsx';

/** Compose the explicitly selected organization task in the existing task route. */
export async function renderOrganizationPage(ctx: HttpRequest, id: string) {
  const i18n = ctx.state.i18n;
  const query = ctx.url.searchParams;
  const download = query.get('download');
  if (
    query.getAll('kind').length !== 1 || query.get('kind') !== 'organization' ||
    query.getAll('download').length > 1 || (download !== null && download !== 'summary') ||
    [...query.keys()].some((key) => key !== 'kind' && key !== 'download')
  ) {
    return requestErrorResponse(i18n, 'invalid_authoring_data', 400);
  }
  if (download === 'summary') {
    const report = await readOrganizationReport(getDb(ctx), requireAuthContext(ctx.state), id);
    if (!report.ok) {
      if (report.code === 'conflict') {
        return new Response(i18n.t('items.organization.report.unavailable'), {
          status: 409,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      return requestErrorResponse(
        i18n,
        report.code === 'forbidden'
          ? 'forbidden'
          : report.code === 'not_found'
          ? 'not_found'
          : report.code === 'invalid_input'
          ? 'invalid_authoring_data'
          : 'internal_server_error',
        report.code === 'forbidden'
          ? 403
          : report.code === 'not_found'
          ? 404
          : report.code === 'invalid_input'
          ? 400
          : 500,
      );
    }
    return new Response(buildOrganizationReport(report.value, i18n, new Date()), {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': attachmentContentDisposition(`organization-${id}.md`),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  const run = await new QuestionOrganizationWorkspace(getDb(ctx), () => new Date()).run(
    requireAuthContext(ctx.state),
    id,
  );
  if (!run.ok) {
    return requestErrorResponse(
      i18n,
      run.code === 'forbidden'
        ? 'forbidden'
        : run.code === 'not_found'
        ? 'not_found'
        : 'internal_server_error',
      run.code === 'forbidden' ? 403 : run.code === 'not_found' ? 404 : 500,
    );
  }
  if (ctx.req.headers.get('Accept') === 'application/json') {
    return Response.json({ state: run.value.state, undoProcessed: run.value.undoProcessed }, {
      headers: { 'Cache-Control': 'no-store', Vary: 'Accept' },
    });
  }
  const rendered = await ctx.render(
    <BankEnrichmentLayout
      title={i18n.t(
        run.value.mode === 'preview' ? 'items.organization.preview' : 'items.organization.apply',
      )}
      backHref='/items/organize'
      i18n={i18n}
    >
      <QuestionOrganizationProgress
        run={run.value}
        operationId={crypto.randomUUID()}
        payload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, ['items'])}
      />
    </BankEnrichmentLayout>,
  );
  rendered.headers.set('Cache-Control', 'no-store');
  rendered.headers.set('Vary', 'Accept');
  return rendered;
}

const QuestionOrganizationProgress = mountIsland({
  component: 'QuestionOrganizationProgress',
  View: QuestionOrganizationProgressView,
});
