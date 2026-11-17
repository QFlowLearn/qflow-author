import { expect, test as testCase } from 'vitest';

import { db } from '../lib/db.ts';
import { readOrganizationReport } from '../lib/services/question_organization_report.ts';
import { buildOrganizationReport } from '../lib/question_organization_report.ts';
import { processOrganizationStep } from '../lib/services/question_organization_processor.ts';
import { QuestionOrganizationWorkspace } from '../lib/services/question_organization_workspace.ts';
import { cancelOrganizationRun } from '../lib/services/question_organization_cancel.ts';
import { bankOrganizationPageRoute as handlerEndpoint } from '../lib/http/routes/bank_pages/organization.tsx';
import { invokeHttpMethod, makeHttpRequest } from './helpers/http_route.ts';
import { organizationNow, withOrganizationWorkspace } from './helpers/organization_workspace.ts';
import { completeOrganizationUndoForTest } from './helpers/organization_undo.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';

const handler = handlerEndpoint.handle;

const services = {
  database: db,
  now: organizationNow,
  newId: () => crypto.randomUUID(),
  provider: () => {
    throw new Error('Report source fixture must not use AI.');
  },
};

async function finish(params: { jobId: string; workflowExecutionId: string }) {
  for (let step = 0; step < 20; step++) {
    const result = await processOrganizationStep(params, services);
    if (!(result.ok)) expect.unreachable('Expected result.ok');
    if (result.value.state === 'completed') return;
  }
  throw new Error('Report fixture did not complete.');
}

testCase(
  'run summary aggregates beyond the sample, separates preserved topics and refuses preview, in-progress and undone reports',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      expect(await readOrganizationReport(db, f.ctx, f.runId)).toStrictEqual({
        ok: false,
        code: 'conflict',
      });
      await finish(f.params);
      const report = await readOrganizationReport(db, f.ctx, f.runId);
      if (!(report.ok)) expect.unreachable('Expected report.ok');
      expect(report.value.counts).toStrictEqual([
        { state: 'applied', count: 29 },
        { state: 'unassigned', count: 2 },
      ]);
      expect(report.value.topics.map((t) => [t.source, t.clef, t.preserved])).toStrictEqual([[
        29,
        0,
        0,
      ]]);
      const workspace = new QuestionOrganizationWorkspace(db, organizationNow);
      const second = await workspace.queue(f.ctx, {
        id: crypto.randomUUID(),
        setupId: f.setupId,
        mode: 'apply',
      });
      if (!(second.ok)) expect.unreachable('Expected second.ok');
      const queued = await workspace.run(f.ctx, second.value);
      if (!(queued.ok)) expect.unreachable('Expected queued.ok');
      await finish({ jobId: second.value, workflowExecutionId: queued.value.executionId });
      const preserved = await readOrganizationReport(db, f.ctx, second.value);
      if (!(preserved.ok)) expect.unreachable('Expected preserved.ok');
      expect(preserved.value.topics.map((t) => [t.source, t.clef, t.preserved])).toStrictEqual([[
        0,
        0,
        29,
      ]]);
      const preview = await workspace.queue(f.ctx, {
        id: crypto.randomUUID(),
        setupId: f.setupId,
        mode: 'preview',
      });
      if (!(preview.ok)) expect.unreachable('Expected preview.ok');
      expect(await readOrganizationReport(db, f.ctx, preview.value)).toStrictEqual({
        ok: false,
        code: 'conflict',
      });
      expect(await readOrganizationReport(db, { ...f.ctx, userId: crypto.randomUUID() }, f.runId))
        .toStrictEqual({ ok: false, code: 'forbidden' });
      expect(await readOrganizationReport(db, f.ctx, crypto.randomUUID())).toStrictEqual({
        ok: false,
        code: 'not_found',
      });
      if (!((await completeOrganizationUndoForTest(db, f.ctx, f.runId, organizationNow())).ok)) {
        expect.unreachable(
          'Expected (await completeOrganizationUndoForTest(db, f.ctx, f.runId, organizationNow())).ok',
        );
      }
      expect(await readOrganizationReport(db, f.ctx, f.runId)).toStrictEqual({
        ok: false,
        code: 'conflict',
      });
    }, {
      count: 31,
      sourceSections: [...Array(29).fill('chapter-1'), 'unmapped', 'unmapped'],
      difficulty: 'none',
    });
  },
);

testCase(
  'summary download uses the authorized route, all locales, safe Markdown and accurate stopped state',
  async () => {
    await withOrganizationWorkspace(async (f) => {
      const stopped = await cancelOrganizationRun(db, f.ctx, f.runId);
      if (!(stopped.ok)) expect.unreachable('Expected stopped.ok');
      const report = await readOrganizationReport(db, f.ctx, f.runId);
      if (!(report.ok)) expect.unreachable('Expected report.ok');
      expect(report.value.state).toStrictEqual('cancelled');
      expect(report.value.topics).toStrictEqual([]);
      for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
        const catalog = catalogForLocale(locale), i18n = createI18n(locale, catalog);
        const url = `http://localhost/items/organize/${f.runId}?kind=organization&download=summary`;
        const response = await invokeHttpMethod(
          handler,
          'GET',
          makeHttpRequest(new Request(url), {
            auth: f.ctx,
            params: { id: f.runId },
            state: { i18n, catalog, interfaceLocale: locale },
          }),
        );
        expect(response.status).toStrictEqual(200);
        expect(response.headers.get('Cache-Control')).toStrictEqual('no-store');
        expect(response.headers.get('Content-Disposition') ?? '').toContain(
          `organization-${f.runId}.md`,
        );
        const text = await response.text();
        expect(text).toContain(i18n.t('items.organization.report.title'));
        expect(text).toContain(i18n.t('items.organization.state.cancelled'));
        expect(text).not.toMatch(/items\.organization\.|gateway|inputTokens|questionId/);
        const escaped = buildOrganizationReport(
          { ...report.value, collection: 'Bank | <script>\n# forged' },
          i18n,
          organizationNow(),
        );
        expect(escaped).toContain('Bank \\| \\<script\\> \\# forged');
      }
      const i18n = createI18n('en-US', catalogForLocale('en-US'));
      for (
        const query of [
          'kind=organization&download=wrong',
          'kind=organization&download=summary&download=summary',
          'kind=organization&extra=1',
        ]
      ) {
        const response = await invokeHttpMethod(
          handler,
          'GET',
          makeHttpRequest(
            new Request(`http://localhost/items/organize/${f.runId}?${query}`),
            { auth: f.ctx, params: { id: f.runId }, state: { i18n } },
          ),
        );
        expect(response.status).toStrictEqual(400);
      }
    }, { difficulty: 'none' });
  },
);
