import { expect, test as testCase } from 'vitest';
import { makeHttpRequest } from './helpers/http_route.ts';

import { renderPage as render } from './helpers/render_page.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import MigrationAdminPage, {
  settingsMigrationsPageRoute as handlerEndpoint,
} from '../lib/http/routes/settings_pages/migrations.tsx';
import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import type { MigrationExecutionState } from '../lib/import/migration_state.ts';
import type { MigrationRunListItem } from '../lib/import/migration_types.ts';

const handler = handlerEndpoint.handle;

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
const execution = (tag: MigrationExecutionState['_tag'], id: string): MigrationExecutionState => {
  if (tag === 'Queued') return { _tag: tag, attempts: 0, maxAttempts: 3, lastFailure: null };
  if (tag === 'Analyzing') {
    return { _tag: tag, attempts: 1, maxAttempts: 3, startedAt: '2026-01-02T03:04:00.000Z' };
  }
  if (tag === 'Analyzed') {
    return { _tag: tag, attempts: 1, maxAttempts: 3, completedAt: '2026-01-02T03:04:00.000Z' };
  }
  if (tag === 'Failed') {
    return {
      _tag: tag,
      attempts: 1,
      maxAttempts: 3,
      failure: '<provider diagnostic>',
      completedAt: '2026-01-02T03:04:00.000Z',
    };
  }
  return {
    _tag: tag,
    attempts: 1,
    maxAttempts: 3,
    completedAt: '2026-01-02T03:04:00.000Z',
    destination: { _tag: 'Assessment', assessmentId: `assessment-${id}` },
    committedAt: '2026-01-02T03:04:00.000Z',
  };
};
function run(
  tag: MigrationExecutionState['_tag'],
  id: string,
  items = 2,
  options: { ready?: boolean; invalidDate?: boolean; missingCreator?: boolean } = {},
): MigrationRunListItem {
  const ready = options.ready ?? false;
  return {
    id,
    batchId: `batch-${id}`,
    batchPosition: 1,
    purpose: 'recover_existing',
    createdBy: 'owner',
    creatorName: options.missingCreator ? null : 'Owner Name',
    creatorEmail: options.missingCreator ? null : 'owner@example.test',
    sourceFilename: `hostile <${id}>.zip`,
    sourceMime: 'application/zip',
    sourceSize: 120,
    adapter: { id: 'adapter', label: 'QTI adapter', version: '1' },
    execution: execution(tag, id),
    approval: { _tag: 'Draft' },
    destination: { _tag: 'Assessment', blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT },
    summary: {
      counts: {
        parts: 1,
        items,
        assets: 1,
        warnings: tag === 'Failed' ? 2 : 1,
        ready: 0,
        reviewNeeded: ready ? 0 : 1,
        blocked: ready ? 0 : 1,
      },
      warningCounts: { IMPORT_FAILED: 2345 },
      itemTypeCounts: {},
    },
    createdAt: options.invalidDate ? 'not-a-date' : '2026-01-02T03:04:00.000Z',
    updatedAt: '2026-01-02T03:04:00.000Z',
    reviewProgress: { total: 3, accepted: 1, pending: 1, rejected: 1 },
  };
}
const runs = [
  run('Queued', 'queued'),
  run('Analyzing', 'analyzing'),
  run('Analyzed', 'ready', 2, { ready: true }),
  run('Analyzed', 'review'),
  run('Committed', 'committed'),
  run('Failed', 'failed', 2, { invalidDate: true, missingCreator: true }),
];
const common = {
  status: '',
  readiness: '',
  review: '',
  q: '',
  stats: {
    total: 12345,
    queued: 1,
    analyzing: 1,
    committed: 1,
    failed: 1,
    accepted: 6,
    pending: 6,
    rejected: 6,
    items: 12,
    warnings: 10,
    blocked: 6,
  },
};

function settingsI18n(locale: (typeof locales)[number]) {
  const catalog = catalogForLocale(locale);
  return createI18n(locale, { core: catalog.core, settings: catalog.settings });
}

for (const locale of locales) {
  testCase(`migrations dashboard renders localized states in ${locale}`, () => {
    const i18n = settingsI18n(locale);
    const html = render(<MigrationAdminPage i18n={i18n} {...common} runs={runs} />);
    for (
      const id of [
        'title',
        'subtitle',
        'bringFiles',
        'runStatus',
        'totalRuns',
        'queued',
        'analyzing',
        'analyzed',
        'committed',
        'failed',
        'reviewWorkload',
        'questions',
        'accepted',
        'pending',
        'rejected',
        'warnings',
        'sourcePreserved',
        'filterTitle',
        'fileOwner',
        'fileOwnerPlaceholder',
        'status',
        'allStatuses',
        'readiness',
        'allReadiness',
        'review',
        'allReview',
        'apply',
        'importRuns',
        'file',
        'owner',
        'issues',
        'created',
        'actions',
        'viewReport',
        'openAssessment',
        'readyToCommit',
        'needsReview',
      ]
    ) expect(html).toContain(i18n.t(`settings.migrations.${id}`));
    expect(html).toContain(i18n.t('settings.migrations.runCount', { count: runs.length }));
    expect(html).toContain(i18n.t('settings.migrations.itemsAssets', { items: 2, assets: 1 }));
    const failureText = i18n.t('settings.migrations.failureDetail', {
      diagnostic: '<provider diagnostic>',
    }).replace('<', '&lt;');
    expect(html).toContain(failureText);
    expect(html).toContain(i18n.formatNumber(12345));
    expect(html).toContain(i18n.formatNumber(2345));
    expect(html).toContain(i18n.formatDate(new Date('2026-01-02T03:04:00.000Z'), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }));
    expect(html).toContain('&lt;provider diagnostic>');
    expect(html).toContain('hostile &lt;queued>.zip');
    expect(html).toContain('Owner Name');
    expect(html).toContain('owner@example.test');
    expect(html).toContain(i18n.t('settings.migrations.readyToCommit'));
    expect(html).toContain(i18n.t('settings.migrations.unavailable'));
    if (html.includes('settings.migrations.')) {
      expect.unreachable("Expected !html.includes('settings.migrations.')");
    }
    if (html.includes('pendings')) expect.unreachable("Expected !html.includes('pendings')");
    if (html.includes(' / of ')) expect.unreachable("Expected !html.includes(' / of ')");
  });
  testCase(`single migration uses singular count in ${locale}`, () => {
    const i18n = settingsI18n(locale);
    const html = render(<MigrationAdminPage i18n={i18n} {...common} runs={[runs[0]]} />);
    expect(html).toContain(i18n.t('settings.migrations.runCount', { count: 1 }));
  });
  testCase(`migration count messages cover plural branches in ${locale}`, () => {
    const i18n = settingsI18n(locale);
    expect(i18n.t('settings.migrations.runCount', { count: 0 })).toContain('0');
    expect(i18n.t('settings.migrations.runCount', { count: 1 })).toContain('1');
    expect(i18n.t('settings.migrations.runCount', { count: 2 })).toContain('2');
    for (
      const id of ['itemsAssets', 'warningCount', 'blockedCount', 'pendingCount', 'rejectedCount']
    ) {
      const message = id === 'itemsAssets'
        ? i18n.t(`settings.migrations.${id}`, { items: 2, assets: 2 })
        : i18n.t(`settings.migrations.${id}`, { count: 2 });
      if (!(message.includes('2'))) expect.unreachable("Expected message.includes('2')");
    }
    for (const accepted of [0, 1, 2]) {
      if (
        !(i18n.t('settings.migrations.reviewProgress', { accepted, total: 2 }).includes(
          `${accepted}`,
        ))
      ) {
        expect.unreachable(
          "Expected i18n.t('settings.migrations.reviewProgress', { accepted, total: 2 }).includes( `${accepted",
        );
      }
    }
  });
  testCase(`empty migrations state renders plural zero in ${locale}`, () => {
    const i18n = settingsI18n(locale);
    const html = render(<MigrationAdminPage i18n={i18n} {...common} runs={[]} />);
    expect(html).toContain(i18n.t('settings.migrations.empty'));
    expect(html).toContain(i18n.t('settings.migrations.runCount', { count: 0 }));
    if (html.includes('settings.migrations.')) {
      expect.unreachable("Expected !html.includes('settings.migrations.')");
    }
  });
}

for (const locale of locales) {
  testCase(`migrations admin denial is localized in ${locale}`, async () => {
    const i18n = settingsI18n(locale);
    const req = new Request('https://example.test/settings/migrations');
    const context = {
      req,
      url: new URL(req.url),
      params: {},
      state: {
        auth: { tenantId: 'tenant', userId: 'user', role: 'teaching_assistant' as const },
        interfaceLocale: locale,
        catalog: {
          core: catalogForLocale(locale).core,
          settings: catalogForLocale(locale).settings,
        },
        i18n,
      },
    };
    const denial = await handler(
      makeHttpRequest(context.req, { state: context.state, auth: context.state.auth }),
    );
    expect(denial.status).toStrictEqual(403);
    expect(await denial.text()).toStrictEqual(i18n.t('settings.migrations.error.forbidden'));
  });
}

testCase('migrations dashboard differs between English and Spanish', () => {
  const en = settingsI18n('en-US');
  const es = settingsI18n('es-ES');
  if (
    !(render(<MigrationAdminPage i18n={en} {...common} runs={runs} />) !==
      render(<MigrationAdminPage i18n={es} {...common} runs={runs} />))
  ) {
    expect.unreachable(
      'Expected render(<MigrationAdminPage i18n={en} {...common} runs={runs} />) !== render(<MigrationAdmi',
    );
  }
});
