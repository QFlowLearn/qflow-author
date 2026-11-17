import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import Button from '../../../../components/ui/Button.tsx';
import { attachmentContentDisposition } from '../../attachment_content_disposition.ts';
import { SAMPLE_QTI_MIGRATION_RUN } from '../../../sample_migration_report.ts';
import { buildMigrationQaReport } from '../../../import/migration_qa_report.ts';
import MigrationReport, {
  qaReportFilename,
} from '../../../../components/imports/migration_report_page.tsx';
import { createI18nPayload } from '../../../i18n/payload.ts';
import { playerMessageCatalogForLocale } from '../../../i18n/player_messages/catalogs.ts';
import type { I18nPayload } from '../../../i18n/payload.ts';
import type { QflowPlayerMessageCatalog } from '../../../i18n/player_messages/types.ts';

/** Shared route contract preserving the existing server-rendered page behavior. */
export const qtiSampleReportPageRoute = defineHttpRoute('/help/qti-sample-report', {
  GET: handleGET,
  HEAD: handleGET,
});

export default function QtiSampleReport({ payload, playerCatalog, i18n }: {
  payload: I18nPayload;
  playerCatalog: QflowPlayerMessageCatalog;
  i18n: import('../../../i18n/messages.ts').I18n;
}) {
  return (
    <div class='max-w-6xl space-y-8'>
      <section class='flex flex-wrap items-start justify-between gap-5 border-b border-base-300 pb-7'>
        <div class='max-w-3xl space-y-2'>
          <h2 class='text-3xl font-medium'>{i18n.t('help.sampleReport.title')}</h2>
          <p class='text-sm leading-6 text-base-content/75'>
            {i18n.t('help.sampleReport.description')}
          </p>
        </div>
        <div class='flex flex-wrap gap-2'>
          <Button href='/help/qti-sample-report?download=qa-report'>
            {i18n.t('help.sampleReport.download')}
          </Button>
          <Button href='/assessments/new?intent=recover' variant='primary'>
            {i18n.t('help.bringFiles')}
          </Button>
        </div>
      </section>

      <MigrationReport
        run={SAMPLE_QTI_MIGRATION_RUN}
        commitError={null}
        title={i18n.t('help.sampleReport.details')}
        readOnly
        itemHrefBase='/help/qti-sample-report'
        payload={payload}
        playerCatalog={playerCatalog}
        i18n={i18n}
      />
    </div>
  );
}

function handleGET(ctx: HttpRequest) {
  const url = ctx.url;
  if (url.searchParams.get('download') === 'qa-report') {
    return new Response(buildMigrationQaReport(SAMPLE_QTI_MIGRATION_RUN), {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': attachmentContentDisposition(
          qaReportFilename(SAMPLE_QTI_MIGRATION_RUN),
        ),
      },
    });
  }

  return ctx.render(
    <QtiSampleReport
      payload={createI18nPayload(ctx.state.interfaceLocale, ctx.state.catalog, [
        'authoring',
        'imports',
      ])}
      playerCatalog={playerMessageCatalogForLocale(ctx.state.interfaceLocale)}
      i18n={ctx.state.i18n}
    />,
  );
}
