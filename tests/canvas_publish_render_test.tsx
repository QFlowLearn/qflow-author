import { expect, test as testCase } from 'vitest';

import { renderPage as renderToString } from './helpers/render_page.tsx';
import { I18nProvider } from '../lib/i18n/context.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../lib/i18n/payload.ts';
import { createI18n } from '../lib/i18n/messages.ts';

import CanvasPublishHistory from '../islands/assessment_builder/CanvasPublishHistory.tsx';
import CanvasPublishStatus from '../islands/assessment_builder/CanvasPublishStatus.tsx';
import CanvasDirectPublish from '../islands/assessment_builder/CanvasDirectPublish.tsx';
import type {
  CanvasPublishesState,
  CanvasPublishUiState,
} from '../islands/assessment_builder/useCanvasPublish.ts';
import { parseCanvasPublishView } from '../lib/lms/canvas_publish_wire.ts';
import type { CanvasPublishTerminalCursorToken } from '../lib/lms/canvas_publish_contract.ts';
import { parseAssessmentExportPreflightId } from '../lib/export/assessment_export_http.ts';

const PUBLISH_ID = 'a505462d-2f72-4d99-ae04-77e10bc783e8';
const CONNECTION_ID = '8fdcd9d7-3cb3-4f7e-8c92-31bd3272fda0';
const CONTENT_ID = 'a'.repeat(64);
const RAW_SENTINEL = 'RAW-WIRE-MESSAGE-MUST-NOT-RENDER';
const OLD_ENGLISH =
  /Loading Canvas connections|Publish directly to Canvas|Canvas connections could not be loaded|Connect your Canvas account|Set up Canvas|Canvas connection|Choose a Canvas connection|Canvas course ID|Import destination|Existing question bank|New question bank|Question bank ID|New question bank name|Sending to Canvas|Publish to Canvas|Start another Canvas publish|Canvas publishes|Loading Canvas publishes|Reload Canvas publishes|Unfinished publishes|Recent results|Load earlier publishes/;
const PREFLIGHT_ID = parseAssessmentExportPreflightId(CONTENT_ID);
if (!PREFLIGHT_ID.ok) throw new Error('Expected valid preflight fixture ID.');
const LOCALES = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
const STATES = [
  'Prepared',
  'ClaimingCreate',
  'Creating',
  'Uploading',
  'Observing',
  'Processing',
  'RetryCreate',
  'RetryUpload',
  'RetryObserve',
  'RemoteIdentityUnknown',
  'RemoteIdentityResolved',
  'Failed',
  'Published',
] as const;

testCase('Canvas publish status exposes the identifier needed for uncertain recovery', () => {
  const publish = publishView('RemoteIdentityUnknown');
  const payload = createI18nPayload('en-US', catalogForLocale('en-US'), ['delivery']);
  const i18n = createI18n('en-US', payload.namespaces);
  const html = renderToString(
    <I18nProvider payload={payload}>
      <CanvasPublishStatus
        publish={publish}
        busy={false}
        requestFailure={null}
        onResume={() => {}}
        onResolveUnknown={() => {}}
      />
    </I18nProvider>,
  );

  expect(html).toContain(i18n.t('delivery.canvas.publishId'));
  expect(html).toContain(PUBLISH_ID);
  expect(html).toContain(`qflow-${PUBLISH_ID}-`);
  expect(html).toContain(i18n.t('delivery.canvas.copyId'));
  expect(html).toContain(i18n.t('delivery.canvas.importFound'));
  expect(html).toContain(i18n.t('delivery.canvas.importNotFound'));
});

testCase('Canvas publish history keeps known recovery work visible after loading fails', () => {
  const publish = publishView('RetryUpload');
  const state: CanvasPublishesState = {
    load: { _tag: 'Failed', code: 'CanvasPublishRequestFailed' },
    actionRequired: [publish],
    terminal: [],
    pagination: { _tag: 'Complete' },
  };
  const payload = createI18nPayload('en-US', catalogForLocale('en-US'), ['delivery']);
  const i18n = createI18n('en-US', payload.namespaces);
  const html = renderToString(
    <I18nProvider payload={payload}>
      <CanvasPublishHistory
        state={state}
        publishState={{
          _tag: 'Submitting',
          command: {
            publishId: PUBLISH_ID,
            connectionId: CONNECTION_ID,
            destination: { type: 'course', courseId: '17' },
          },
        }}
        busy
        onResume={() => {}}
        onResolveUnknown={() => {}}
        onReload={() => {}}
        onLoadMore={() => {}}
      />
    </I18nProvider>,
  );

  expect(html).toContain(
    i18n.t('delivery.canvas.historyLoadFailed', { code: 'CanvasPublishRequestFailed' }),
  );
  expect(html).toContain(i18n.t('delivery.canvas.reloadHistory'));
  expect(html).toContain(i18n.t('delivery.canvas.unfinished'));
  expect(html).toContain(i18n.t('delivery.canvas.checking'));
  expect(html).toContain('disabled');
});

testCase('Canvas publish status is a complete four-locale state matrix', () => {
  for (const locale of LOCALES) {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['delivery']);
    const i18n = createI18n(locale, payload.namespaces);
    for (const state of STATES) {
      for (
        const outcome of state === 'RemoteIdentityResolved'
          ? (['import-found', 'import-not-found'] as const)
          : [null]
      ) {
        const publish = publishView(
          state,
          outcome ?? undefined,
          state === 'Failed' ? 'present' : undefined,
        );
        const html = renderToString(
          <I18nProvider payload={payload}>
            <CanvasPublishStatus
              publish={publish}
              busy={false}
              requestFailure={null}
              onResume={() => {}}
              onResolveUnknown={() => {}}
            />
          </I18nProvider>,
        );
        expect(html).not.toMatch(/delivery\.canvas\./);
        expect(html).not.toMatch(/RAW-WIRE-MESSAGE-MUST-NOT-RENDER|\{[^}]+\}/);
        if (locale === 'es-ES' || locale === 'es-419') expect(html).not.toMatch(OLD_ENGLISH);
        expect(html).toContain(PUBLISH_ID);
        expect(html).toContain('Canvas production');
        expect(html).toContain('17');
        if (state === 'RemoteIdentityUnknown' || state === 'RemoteIdentityResolved') {
          expect(html).toContain('CanvasRemoteIdentityUnknown');
        } else if (
          state !== 'Prepared' && state !== 'ClaimingCreate' && state !== 'Creating' &&
          state !== 'Uploading' && state !== 'Observing' && state !== 'Processing' &&
          state !== 'Published'
        ) expect(html).toContain('CanvasUnavailable');
        expect(html).toContain(
          state === 'Prepared'
            ? i18n.t('delivery.canvas.packagePreserved')
            : state === 'Processing'
            ? i18n.t('delivery.canvas.processing')
            : state === 'Published'
            ? i18n.t('delivery.canvas.published')
            : state === 'RemoteIdentityUnknown'
            ? i18n.t('delivery.canvas.unknownHeading')
            : state === 'RemoteIdentityResolved'
            ? i18n.t('delivery.canvas.resolvedHeading')
            : state.startsWith('Retry')
            ? i18n.t('delivery.canvas.retryHeading')
            : state === 'Failed'
            ? i18n.t('delivery.canvas.failedHeading')
            : i18n.t('delivery.canvas.sending'),
        );
        expect(html).toContain(expectedMessage(state, outcome, i18n));
        expect(html).toContain(i18n.t('delivery.canvas.downloadPackage'));
        const resumable = [
          'Prepared',
          'ClaimingCreate',
          'Creating',
          'Uploading',
          'Observing',
          'Processing',
        ]
          .includes(state);
        const retryable = ['RetryCreate', 'RetryUpload', 'RetryObserve'].includes(state);
        if (resumable) expect(html).toContain(i18n.t('delivery.canvas.checkStatus'));
        else expect(html).not.toMatch(/Check Canvas status|Comprobar estado en Canvas/);
        if (retryable) expect(html).toContain(i18n.t('delivery.canvas.retry'));
        else expect(html).not.toMatch(/Retry Canvas publish|Reintentar publicación en Canvas/);
        if (state === 'RemoteIdentityUnknown') {
          expect(html).toContain(i18n.t('delivery.canvas.importFound'));
          expect(html).toContain(i18n.t('delivery.canvas.importNotFound'));
        } else {
          expect(html).not.toMatch(
            /I found the import|He encontrado la importación|Encontré la importación/,
          );
          expect(html).not.toMatch(
            /No import found|No he encontrado la importación|No encontré la importación/,
          );
        }
        if (state === 'Published') {
          expect(html).toContain(i18n.t('delivery.canvas.downloadReceipt'));
        } else expect(html).not.toMatch(/Download publish receipt|Descargar recibo de publicación/);
        if (
          [
            'Uploading',
            'Observing',
            'Processing',
            'RetryUpload',
            'RetryObserve',
            'Failed',
            'Published',
          ]
            .includes(state)
        ) expect(html).toContain(i18n.t('delivery.canvas.migration', { id: '42' }));
        else expect(html).not.toMatch(/Canvas migration 42|Migración de Canvas 42/);
      }
    }
    for (const remote of ['present', 'null'] as const) {
      const html = renderToString(
        <I18nProvider payload={payload}>
          <CanvasPublishStatus
            publish={publishView('Failed', undefined, remote)}
            busy={false}
            requestFailure={null}
            onResume={() => {}}
            onResolveUnknown={() => {}}
          />
        </I18nProvider>,
      );
      expect(html).toContain(i18n.t('delivery.canvas.failedHeading'));
      expect(html).toContain(
        i18n.t('delivery.canvas.failureMessage', { code: 'CanvasUnavailable' }),
      );
      if (remote === 'present') {
        expect(html).toContain(i18n.t('delivery.canvas.migration', { id: '42' }));
      } else expect(html).not.toMatch(/Canvas migration 42|Migración de Canvas 42/);
    }
  }
});

testCase('Canvas publish history renders every load and pagination state', () => {
  for (const locale of LOCALES) {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['delivery']);
    const i18n = createI18n(locale, payload.namespaces);
    const publish = publishView('RetryUpload');
    for (
      const load of [{ _tag: 'Loading' as const }, { _tag: 'Loaded' as const }, {
        _tag: 'Failed' as const,
        code: 'CanvasPublishRequestFailed',
      }]
    ) {
      for (
        const pagination of [
          { _tag: 'Complete' as const },
          {
            _tag: 'Available' as const,
            cursor: 'cursor' as CanvasPublishTerminalCursorToken,
          },
          { _tag: 'Loading' as const, cursor: 'cursor' as CanvasPublishTerminalCursorToken },
          {
            _tag: 'Failed' as const,
            cursor: 'cursor' as CanvasPublishTerminalCursorToken,
            code: 'CanvasUnavailable',
          },
        ]
      ) {
        const html = renderToString(
          <I18nProvider payload={payload}>
            <CanvasPublishHistory
              state={{ load, actionRequired: [publish], terminal: [], pagination }}
              publishState={{ _tag: 'Idle' }}
              busy={false}
              onResume={() => {}}
              onResolveUnknown={() => {}}
              onReload={() => {}}
              onLoadMore={() => {}}
            />
          </I18nProvider>,
        );
        expect(html).not.toMatch(/delivery\.canvas\./);
        expect(html).toContain(i18n.t('delivery.canvas.historyTitle'));
        expect(html).toContain(i18n.t('delivery.canvas.unfinished'));
        if (pagination._tag === 'Failed') {
          expect(html).toContain(
            i18n.t('delivery.canvas.paginationFailed', { code: pagination.code }),
          );
        }
        if (
          pagination._tag === 'Available' || pagination._tag === 'Loading' ||
          pagination._tag === 'Failed'
        ) {
          expect(html).toContain(
            pagination._tag === 'Loading'
              ? i18n.t('delivery.canvas.loadingEarlier')
              : i18n.t('delivery.canvas.loadEarlier'),
          );
          if (pagination._tag === 'Loading') {
            const labelIndex = html.indexOf(i18n.t('delivery.canvas.loadingEarlier'));
            const openingTag = html.slice(
              html.lastIndexOf('<button', labelIndex),
              html.indexOf('>', labelIndex) + 1,
            );
            expect(openingTag).toContain('disabled');
          }
        }
      }
    }
  }
});

testCase('Canvas publish history reaches empty, retained, and request-failure branches', () => {
  for (const locale of LOCALES) {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['delivery']);
    const i18n = createI18n(locale, payload.namespaces);
    const renderHistory = (state: CanvasPublishesState, publishState: CanvasPublishUiState) =>
      renderToString(
        <I18nProvider payload={payload}>
          <CanvasPublishHistory
            state={state}
            publishState={publishState}
            busy={false}
            onResume={() => {}}
            onResolveUnknown={() => {}}
            onReload={() => {}}
            onLoadMore={() => {}}
          />
        </I18nProvider>,
      );
    const empty = (load: CanvasPublishesState['load']) => ({
      load,
      actionRequired: [],
      terminal: [],
      pagination: { _tag: 'Complete' as const },
    });
    const loadingEmptyHtml = renderHistory(empty({ _tag: 'Loading' }), { _tag: 'Idle' });
    expect(loadingEmptyHtml).toContain(`aria-label="${i18n.t('delivery.canvas.loadingHistory')}"`);
    expect(renderHistory(empty({ _tag: 'Loaded' }), { _tag: 'Idle' })).toContain(
      i18n.t('delivery.canvas.emptyHistory'),
    );
    const failedEmptyHtml = renderHistory(empty({ _tag: 'Failed', code: 'CanvasUnavailable' }), {
      _tag: 'Idle',
    });
    expect(failedEmptyHtml).toContain(
      i18n.t('delivery.canvas.historyLoadFailed', { code: 'CanvasUnavailable' }),
    );
    expect(failedEmptyHtml).toContain(i18n.t('delivery.canvas.reloadHistory'));
    expect(failedEmptyHtml).not.toMatch(/RAW-WIRE-MESSAGE-MUST-NOT-RENDER/);
    const retry = publishView('RetryUpload');
    const unknown = publishView('RemoteIdentityUnknown');
    const retained = {
      load: { _tag: 'Failed' as const, code: 'CanvasUnavailable' },
      actionRequired: [retry],
      terminal: [unknown],
      pagination: { _tag: 'Complete' as const },
    };
    const retainedHtml = renderHistory(retained, {
      _tag: 'ResumeFailed',
      publish: retry,
      code: 'ResumeRequestFailed',
    });
    expect(retainedHtml).toContain(i18n.t('delivery.canvas.unfinished'));
    expect(retainedHtml).toContain(i18n.t('delivery.canvas.recentResults'));
    expect(retainedHtml).toContain(
      i18n.t('delivery.canvas.failureMessage', { code: 'ResumeRequestFailed' }),
    );
    const resolutionHtml = renderHistory(retained, {
      _tag: 'ResolutionFailed',
      publish: unknown,
      code: 'CanvasUnavailable',
    });
    expect(resolutionHtml).toContain(
      i18n.t('delivery.canvas.failureMessage', { code: 'CanvasUnavailable' }),
    );
    const nonMatchingHtml = renderHistory(retained, {
      _tag: 'ResumeFailed',
      publish: publishView(
        'RetryCreate',
        undefined,
        'present',
        'b505462d-2f72-4d99-ae04-77e10bc783e8',
      ),
      code: 'ResumeRequestFailed',
    });
    expect(nonMatchingHtml).toContain(i18n.t('delivery.canvas.retry'));
    expect(nonMatchingHtml).not.toMatch(/ResumeRequestFailed/);
    expect(nonMatchingHtml).toContain(
      i18n.t('delivery.canvas.failureMessage', { code: 'CanvasUnavailable' }),
    );
    expect(retainedHtml).not.toMatch(/RAW-WIRE-MESSAGE-MUST-NOT-RENDER|\{[^}]+\}/);
    if (locale === 'es-ES' || locale === 'es-419') expect(retainedHtml).not.toMatch(OLD_ENGLISH);
  }
});

testCase('Canvas direct publish has localized deterministic SSR loading names', () => {
  for (const locale of LOCALES) {
    const payload = createI18nPayload(locale, catalogForLocale(locale), ['delivery']);
    const i18n = createI18n(locale, payload.namespaces);
    const html = renderToString(
      <I18nProvider payload={payload}>
        <CanvasDirectPublish
          assessmentId='assessment-1'
          selection={{
            revisionFingerprint: 'revision-1',
            targetId: 'canvas-classic',
            requirements: {
              scoring: 'automatic',
              interaction: 'preserve',
            },
          }}
          preflight={{
            _tag: 'Evaluated',
            preflightId: PREFLIGHT_ID.preflightId,
            destinationId: 'canvas-classic',
            targetContractId: 'canvas-classic@1',
            overallOutcome: 'preserved',
            items: [],
            packageDiagnosticCodes: [],
            warningCodes: [],
            acknowledgementToken: null,
            repairs: [],
            artifact: { filename: 'assessment.zip', mediaType: 'application/zip', byteLength: 1 },
          }}
        />
      </I18nProvider>,
    );
    expect(html).toContain(i18n.t('delivery.canvas.loadingConnections'));
    expect(html).toContain(i18n.t('delivery.canvas.historyTitle'));
    expect(html).not.toMatch(/delivery\.canvas\./);
    expect(html).not.toMatch(/RAW-WIRE-MESSAGE-MUST-NOT-RENDER|\{[^}]+\}/);
    if (locale === 'es-ES' || locale === 'es-419') expect(html).not.toMatch(OLD_ENGLISH);
  }
});

function expectedMessage(
  state: typeof STATES[number],
  outcome: 'import-found' | 'import-not-found' | null,
  i18n: ReturnType<typeof createI18n>,
) {
  if (state === 'Prepared') return i18n.t('delivery.canvas.preparedMessage');
  if (['ClaimingCreate', 'Creating', 'Uploading', 'Observing'].includes(state)) {
    return i18n.t('delivery.canvas.sendingMessage');
  }
  if (state === 'Processing') return i18n.t('delivery.canvas.processingMessage');
  if (state === 'Published') return i18n.t('delivery.canvas.publishedMessage');
  if (state === 'RemoteIdentityResolved') {
    return i18n.t(
      outcome === 'import-found'
        ? 'delivery.canvas.importRecorded'
        : 'delivery.canvas.importNotRecorded',
    );
  }
  return i18n.t('delivery.canvas.failureMessage', {
    code: state === 'RemoteIdentityUnknown' ? 'CanvasRemoteIdentityUnknown' : 'CanvasUnavailable',
  });
}

function publishView(
  state: typeof STATES[number],
  outcome?: 'import-found' | 'import-not-found',
  failedRemote: 'present' | 'null' = 'present',
  id: string = PUBLISH_ID,
) {
  const remote = { contentMigrationId: '42', workflowState: 'created' };
  const parsed = parseCanvasPublishView({
    id,
    connection: {
      id: CONNECTION_ID,
      name: 'Canvas production',
      baseUrl: 'https://canvas.example.edu',
    },
    targetId: 'canvas-classic',
    destination: { _tag: 'Course', courseId: '17' },
    exportReceiptId: CONTENT_ID,
    artifact: {
      filename: 'assessment-canvas-classic.zip',
      mediaType: 'application/zip',
      sha256: CONTENT_ID,
      byteLength: 3,
      packageUrl:
        `https://qflow.example/api/assessments/assessment-1/canvas-publishes/${PUBLISH_ID}/package`,
    },
    attemptCount: 1,
    state: state === 'Prepared'
      ? { _tag: 'Prepared' }
      : state === 'ClaimingCreate'
      ? { _tag: 'ClaimingCreate' }
      : state === 'Creating'
      ? { _tag: 'Creating', startedAt: '2026-08-05T12:00:00.000Z' }
      : state === 'Uploading'
      ? { _tag: 'Uploading', remote }
      : state === 'Observing'
      ? { _tag: 'Observing', remote }
      : state === 'Processing'
      ? { _tag: 'Processing', remote }
      : state === 'RetryCreate'
      ? { _tag: 'RetryCreate', failure: { code: 'CanvasUnavailable', message: RAW_SENTINEL } }
      : state === 'RetryUpload'
      ? {
        _tag: 'RetryUpload',
        remote,
        failure: { code: 'CanvasUnavailable', message: RAW_SENTINEL },
      }
      : state === 'RetryObserve'
      ? {
        _tag: 'RetryObserve',
        remote,
        failure: { code: 'CanvasUnavailable', message: RAW_SENTINEL },
      }
      : state === 'RemoteIdentityResolved'
      ? {
        _tag: 'RemoteIdentityResolved',
        startedAt: '2026-08-05T12:00:00.000Z',
        resolvedAt: '2026-08-05T12:00:01.000Z',
        outcome: outcome ?? 'import-found',
        failure: {
          code: 'CanvasRemoteIdentityUnknown',
          message: RAW_SENTINEL,
          extra: RAW_SENTINEL,
        },
      }
      : state === 'Failed'
      ? {
        _tag: 'Failed',
        remote: failedRemote === 'present' ? remote : null,
        failure: { code: 'CanvasUnavailable', message: RAW_SENTINEL },
      }
      : state === 'Published'
      ? {
        _tag: 'Published',
        remote,
        receiptUrl: 'https://qflow.example/receipt',
        publishedAt: '2026-08-05T12:00:01.000Z',
      }
      : {
        _tag: 'RemoteIdentityUnknown',
        startedAt: '2026-08-05T12:00:00.000Z',
        failure: {
          code: 'CanvasRemoteIdentityUnknown',
          message: RAW_SENTINEL,
        },
      },
    createdAt: '2026-08-05T12:00:00.000Z',
    updatedAt: '2026-08-05T12:00:01.000Z',
  });
  if (!parsed) throw new Error('Expected valid Canvas publish view.');
  return parsed;
}
