import { expect, test as testCase } from 'vitest';

import { eq } from 'drizzle-orm';

import { UNSPECIFIED_ASSESSMENT_BLUEPRINT } from '../lib/assessment_blueprint.ts';
import { db, shutdownDb } from '../lib/db.ts';
import {
  assessmentCanvasPublishAttempts,
  assessmentExportReceipts,
  assessmentParts,
  assessmentPlacements,
  assessments,
  canvasConnections,
  organizationMemberships,
  questionRevisions,
  questions,
  tenants,
  users,
} from '../lib/db/schema.ts';
import { advanceCanvasPublish } from '../lib/lms/canvas_publish_service.ts';
import { parseCanvasConnectionId } from '../lib/lms/canvas_connections.ts';
import { parseCanvasPublishId } from '../lib/lms/canvas_publish_contract.ts';
import {
  findCanvasPublishAttempt,
  prepareCanvasPublishAttempt,
} from '../lib/lms/canvas_publish_store.ts';
import {
  claimCanvasPublishAttempt,
  markCanvasRemoteCreationStarted,
} from '../lib/lms/canvas_publish_transition_store.ts';
import { parseCanvasPublishPageView } from '../lib/lms/canvas_publish_wire.ts';
import {
  createCanvasPublish,
  loadCanvasConnections,
  loadCanvasPublishes,
  resolveCanvasRemoteIdentity,
  resumeCanvasPublish,
} from '../lib/client/canvas_publish.ts';
import { openCanvasPublishHttp } from './helpers/canvas_publish_http.ts';
import { sha256Hex } from '../lib/sha256.ts';
import { saveAssessment } from './assessment_fixture.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { createCanvasPublishHandler } from '../lib/http/routes/assessment_api/publish_canvas.ts';
import { canvasPublishesApiRoute as publishListHandlerEndpoint } from '../lib/http/routes/assessment_api/canvas_publishes.ts';
import { canvasPublishReceiptApiRoute as publishReceiptHandlerEndpoint } from '../lib/http/routes/assessment_api/canvas_publish_receipt.ts';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';
import { createMemoryObjectStorage } from './memory_object_storage.ts';
import { invokeHttpRoute, makeHttpRequest } from './helpers/http_route.ts';
import {
  authorizedCanvasFetch,
  canvasTestRuntime,
  deleteCanvasConnectionFixture,
  seedCanvasConnectionFixture,
  TEST_CANVAS_CONNECTION_ID,
} from './canvas_connection_fixture.ts';
import {
  canvasMigration,
  recoverableCanvasFetch,
  successfulCanvasFetch,
} from './canvas_publish_transport_fixture.ts';
import {
  canvasCourseDestination,
  createTerminalHistoryAttempts,
  exportCanvasPackage,
  preserveAndPrepare,
  readPreservedPackage,
} from './canvas_publish_export_fixture.ts';

const publishListHandler = publishListHandlerEndpoint.handle;
const publishReceiptHandler = publishReceiptHandlerEndpoint.handle;

const CONNECTION_ID = TEST_CANVAS_CONNECTION_ID;

testCase('Canvas publishing is package-backed, idempotent, receipted, and recoverable', {
  skip: !process.env['DATABASE_URL'],
}, async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const auth: RequestContext = { tenantId, userId, role: 'owner' };
  const storage = createMemoryObjectStorage();
  let assessmentId: string | null = null;
  let questionId: string | null = null;
  let http: Awaited<ReturnType<typeof openCanvasPublishHttp>> | null = null;

  try {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `canvas-publish-${tenantId.slice(0, 8)}`,
      name: 'Canvas Publish Test',
    });
    const email = `canvas-publish-${tenantId.slice(0, 8)}@example.com`;
    await db.insert(users).values({ id: userId, email, emailNormalized: email });
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });
    const runtime = canvasTestRuntime();
    await seedCanvasConnectionFixture(auth, runtime);
    const question = await saveQuestionRevisionFixture(auth, {
      title: 'Select one',
      body: singleSelectDraft(),
      qtiXml: exportQti3TestItemXml('single_select', singleSelectDraft(), {
        identifier: 'canvas-publish-question',
      }),
      draftState: 'published',
      provenance: { _tag: 'Authored' },
    });
    questionId = question.questionId;
    const assessment = await saveAssessment(auth, {
      blueprint: UNSPECIFIED_ASSESSMENT_BLUEPRINT,
      title: 'Canvas publish assessment',
      parts: [{ title: 'Part 1', placements: [{ itemId: question.questionId }] }],
    });
    assessmentId = assessment.id;

    const exported = await exportCanvasPackage(auth, assessment.id, storage);
    const connectionId = parseCanvasConnectionId(CONNECTION_ID);
    if (!connectionId) throw new Error('Expected valid test connection ID.');
    const firstPublishId = parseCanvasPublishId(crypto.randomUUID());
    if (!firstPublishId) throw new Error('Expected valid publish ID.');
    const successCalls: string[] = [];
    http = await openCanvasPublishHttp({
      auth,
      assessmentId: assessment.id,
      storage,
      runtime,
      canvasFetch: successfulCanvasFetch(successCalls),
    });
    const clientOptions = { fetchImpl: http.fetchImpl };
    const createdByClient = await createCanvasPublish({
      assessmentId: assessment.id,
      publishId: firstPublishId,
      connectionId,
      targetId: 'canvas-classic',
      destination: { type: 'course', courseId: '17' },
      preflightId: exported.preflightId,
      acknowledgement: exported.acknowledgement,
      selection: { scoring: 'automatic', interaction: 'preserve' },
    }, clientOptions);
    if (!(createdByClient.ok)) expect.unreachable('Expected createdByClient.ok');
    expect(createdByClient.value.id).toStrictEqual(firstPublishId);
    expect(createdByClient.value.state._tag).toStrictEqual('Published');
    expect(createdByClient.value.attemptCount).toStrictEqual(1);
    const createResponse = await invokeHttpRoute(
      createCanvasPublishHandler({ fetchImpl: successfulCanvasFetch(successCalls) }),
      makeHttpRequest(
        new Request(
          `https://qflow.example/api/assessments/${assessment.id}/publish/canvas`,
          {
            ...{ duplex: 'half' },
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': firstPublishId,
            },
            body: JSON.stringify({
              connectionId,
              targetId: 'canvas-classic',
              destination: { type: 'course', courseId: '17' },
              preflightId: exported.preflightId,
              acknowledgement: exported.acknowledgement,
              scoring: 'automatic',
              interaction: 'preserve',
            }),
          },
        ),
        {
          params: { id: assessment.id },
          auth,
          state: { storage, runtime },
        },
      ),
    );
    expect(createResponse.status).toStrictEqual(200);
    expect(createResponse.headers.get('x-qflow-canvas-publish-id')).toStrictEqual(firstPublishId);
    const completed = await findCanvasPublishAttempt(
      auth,
      assessment.id,
      firstPublishId,
    );
    if (!(completed.ok)) expect.unreachable('Expected completed.ok');
    expect(completed.attempt.state._tag).toStrictEqual('Published');
    expect(completed.attempt.attemptCount).toStrictEqual(1);
    if (completed.attempt.state._tag !== 'Published') {
      throw new Error('Expected publish receipt.');
    }
    expect(completed.attempt.state.remote.contentMigrationId).toStrictEqual('42');
    expect(completed.attempt.state.receipt.exportReceiptId).toStrictEqual(
      completed.attempt.exportReceiptId,
    );
    expect(completed.attempt.state.receipt.remote.contentMigrationId).toStrictEqual('42');
    const connections = await loadCanvasConnections(clientOptions);
    if (!(connections.ok)) expect.unreachable('Expected connections.ok');
    expect(connections.value.map((connection) => connection.id)).toStrictEqual([connectionId]);
    expect(JSON.stringify(connections.value).includes('encrypted')).toStrictEqual(false);
    const resumed = await resumeCanvasPublish(assessment.id, firstPublishId, clientOptions);
    if (!(resumed.ok)) expect.unreachable('Expected resumed.ok');
    expect(resumed.value.id).toStrictEqual(firstPublishId);
    expect(resumed.value.state._tag).toStrictEqual('Published');

    const directPackage = await readPreservedPackage(
      auth,
      assessment.id,
      firstPublishId,
      storage,
    );
    expect(Array.from(directPackage)).toStrictEqual(Array.from(exported.bytes));

    const replayCalls: string[] = [];
    const replay = await advanceCanvasPublish(auth, {
      assessmentId: assessment.id,
      publishId: firstPublishId,
      storage,
      runtime,
    }, {
      fetchImpl: (input) => {
        replayCalls.push(String(input));
        throw new Error('Completed publish must not contact Canvas.');
      },
    });
    if (!(replay.ok)) expect.unreachable('Expected replay.ok');
    expect(replay.attempt.state._tag).toStrictEqual('Published');
    expect(replayCalls).toStrictEqual([]);

    const receiptResponse = await invokeHttpRoute(
      publishReceiptHandler,
      makeHttpRequest(
        new Request(
          `https://qflow.example/api/assessments/${assessment.id}/canvas-publishes/${firstPublishId}/receipt`,
        ),
        {
          params: { id: assessment.id, publishId: firstPublishId },
          auth,
        },
      ),
    );
    expect(receiptResponse.status).toStrictEqual(200);
    expect((await receiptResponse.json()).publishId).toStrictEqual(firstPublishId);

    const secondPublishId = parseCanvasPublishId(crypto.randomUUID());
    if (!secondPublishId) throw new Error('Expected valid publish ID.');
    await preserveAndPrepare({
      auth,
      assessmentId: assessment.id,
      publishId: secondPublishId,
      connectionId,
      exportReceipt: exported.receipt,
      bytes: exported.bytes,
      storage,
      requestFingerprint: await sha256Hex(new TextEncoder().encode('second request')),
    });
    const recovery = recoverableCanvasFetch();
    const interrupted = await advanceCanvasPublish(auth, {
      assessmentId: assessment.id,
      publishId: secondPublishId,
      storage,
      runtime,
    }, { fetchImpl: recovery.fetch });
    if (!(interrupted.ok)) expect.unreachable('Expected interrupted.ok');
    expect(interrupted.attempt.state._tag).toStrictEqual('RetryUpload');
    if (interrupted.attempt.state._tag !== 'RetryUpload') throw new Error('Expected retry.');
    expect(interrupted.attempt.state.remote.contentMigrationId).toStrictEqual('77');
    expect(interrupted.attempt.state.failure).toStrictEqual({
      code: 'CanvasUploadFailed',
      message: 'Canvas could not receive the preserved package.',
    });

    const terminalHistoryIds = await createTerminalHistoryAttempts({
      auth,
      assessmentId: assessment.id,
      connectionId,
      exportReceipt: exported.receipt,
      bytes: exported.bytes,
      storage,
      count: 21,
    });

    const publishListResponse = await invokeHttpRoute(
      publishListHandler,
      makeHttpRequest(
        new Request(
          `${http.origin}/api/assessments/${assessment.id}/canvas-publishes?target=canvas-classic`,
        ),
        {
          params: { id: assessment.id },
          auth,
        },
      ),
    );
    expect(publishListResponse.status).toStrictEqual(200);
    expect(publishListResponse.headers.get('cache-control')).toStrictEqual('private, no-store');
    const firstPage = parseCanvasPublishPageView(await publishListResponse.json());
    if (!firstPage) throw new Error('Expected valid first Canvas publish page.');
    expect(
      firstPage.actionRequired.some((publish) =>
        publish.id === secondPublishId && publish.state._tag === 'RetryUpload'
      ),
    ).toStrictEqual(true);
    expect(firstPage.terminal.length).toStrictEqual(20);
    if (!firstPage.nextTerminalCursor) throw new Error('Expected terminal history cursor.');
    const clientPage = await loadCanvasPublishes(assessment.id, 'canvas-classic', clientOptions);
    if (!(clientPage.ok)) expect.unreachable('Expected clientPage.ok');
    expect(clientPage.value).toStrictEqual(firstPage);
    const nextPageResult = await loadCanvasPublishes(assessment.id, 'canvas-classic', {
      ...clientOptions,
      terminalCursor: firstPage.nextTerminalCursor,
    });
    if (!(nextPageResult.ok)) expect.unreachable('Expected nextPageResult.ok');
    const nextPage = nextPageResult.value;
    expect(nextPage.terminal.some((publish) => publish.id === terminalHistoryIds[0])).toStrictEqual(
      true,
    );

    const packageBytes = await readPreservedPackage(
      auth,
      assessment.id,
      secondPublishId,
      storage,
    );
    expect(Array.from(packageBytes)).toStrictEqual(Array.from(exported.bytes));

    const recovered = await advanceCanvasPublish(auth, {
      assessmentId: assessment.id,
      publishId: secondPublishId,
      storage,
      runtime,
    }, { fetchImpl: recovery.fetch });
    if (!(recovered.ok)) expect.unreachable('Expected recovered.ok');
    expect(recovered.attempt.state._tag).toStrictEqual('Published');
    expect(recovered.attempt.attemptCount).toStrictEqual(2);
    if (recovered.attempt.state._tag !== 'Published') throw new Error('Expected recovery.');
    expect(recovered.attempt.state.remote.contentMigrationId).toStrictEqual('77');
    expect(recovery.createCount()).toStrictEqual(1);
    expect(recovery.refreshCount()).toStrictEqual(1);

    const uncertainPublishId = parseCanvasPublishId(crypto.randomUUID());
    if (!uncertainPublishId) throw new Error('Expected valid publish ID.');
    await preserveAndPrepare({
      auth,
      assessmentId: assessment.id,
      publishId: uncertainPublishId,
      connectionId,
      exportReceipt: exported.receipt,
      bytes: exported.bytes,
      storage,
      requestFingerprint: await sha256Hex(new TextEncoder().encode('uncertain request')),
    });
    let uncertainCreateCalls = 0;
    const uncertain = await advanceCanvasPublish(auth, {
      assessmentId: assessment.id,
      publishId: uncertainPublishId,
      storage,
      runtime,
    }, {
      fetchImpl: authorizedCanvasFetch('test-token', () => {
        uncertainCreateCalls += 1;
        return Promise.resolve(new Response(null, { status: 503 }));
      }),
    });
    if (!(uncertain.ok)) expect.unreachable('Expected uncertain.ok');
    expect(uncertain.attempt.state._tag).toStrictEqual('RemoteIdentityUnknown');
    if (uncertain.attempt.state._tag !== 'RemoteIdentityUnknown') {
      throw new Error('Expected uncertain remote identity.');
    }
    expect(uncertain.attempt.state.failure.code).toStrictEqual('CanvasRemoteIdentityUnknown');
    expect(uncertainCreateCalls).toStrictEqual(1);

    const uncertainReplay = await advanceCanvasPublish(auth, {
      assessmentId: assessment.id,
      publishId: uncertainPublishId,
      storage,
      runtime,
    }, {
      fetchImpl: () => {
        throw new Error('An uncertain migration identity must not create another Canvas import.');
      },
    });
    if (!(uncertainReplay.ok)) expect.unreachable('Expected uncertainReplay.ok');
    expect(uncertainReplay.attempt.state._tag).toStrictEqual('RemoteIdentityUnknown');
    expect(uncertainReplay.attempt.attemptCount).toStrictEqual(1);

    const resolvedUnknownResult = await resolveCanvasRemoteIdentity(
      assessment.id,
      uncertainPublishId,
      'import-not-found',
      clientOptions,
    );
    if (!(resolvedUnknownResult.ok)) expect.unreachable('Expected resolvedUnknownResult.ok');
    expect(resolvedUnknownResult.value.id).toStrictEqual(uncertainPublishId);
    expect(resolvedUnknownResult.value.state._tag).toStrictEqual('RemoteIdentityResolved');
    const resolvedUnknown = await findCanvasPublishAttempt(
      auth,
      assessment.id,
      uncertainPublishId,
    );
    if (!(resolvedUnknown.ok)) expect.unreachable('Expected resolvedUnknown.ok');
    expect(resolvedUnknown.attempt.state._tag).toStrictEqual('RemoteIdentityResolved');
    if (resolvedUnknown.attempt.state._tag !== 'RemoteIdentityResolved') {
      throw new Error('Expected the author decision to close the uncertain create.');
    }
    expect(resolvedUnknown.attempt.state.resolution.outcome).toStrictEqual('import-not-found');
    expect(resolvedUnknown.attempt.state.resolution.resolvedBy).toStrictEqual(userId);

    const credentialPublishId = parseCanvasPublishId(crypto.randomUUID());
    if (!credentialPublishId) throw new Error('Expected valid publish ID.');
    await preserveAndPrepare({
      auth,
      assessmentId: assessment.id,
      publishId: credentialPublishId,
      connectionId,
      exportReceipt: exported.receipt,
      bytes: exported.bytes,
      storage,
      requestFingerprint: await sha256Hex(new TextEncoder().encode('credential repair')),
    });
    const credentialHeaders: string[] = [];
    const rejectedCredential = await advanceCanvasPublish(auth, {
      assessmentId: assessment.id,
      publishId: credentialPublishId,
      storage,
      runtime,
    }, {
      fetchImpl: authorizedCanvasFetch('expired-token', (_input, init) => {
        credentialHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
        return Promise.resolve(Response.json({}, { status: 401 }));
      }),
    });
    if (!(rejectedCredential.ok)) {
      expect.unreachable(
        rejectedCredential.ok
          ? undefined
          : `${rejectedCredential.error._tag}: ${rejectedCredential.error.message}`,
      );
    }
    expect(rejectedCredential.attempt.state._tag).toStrictEqual('RetryCreate');
    expect(credentialHeaders).toStrictEqual(['Bearer expired-token']);

    const repairedCredential = await advanceCanvasPublish(auth, {
      assessmentId: assessment.id,
      publishId: credentialPublishId,
      storage,
      runtime,
    }, { fetchImpl: successfulCanvasFetch([]) });
    if (!(repairedCredential.ok)) expect.unreachable('Expected repairedCredential.ok');
    expect(repairedCredential.attempt.state._tag).toStrictEqual('Published');
    expect(repairedCredential.attempt.attemptCount).toStrictEqual(2);

    const observeCredentialPublishId = parseCanvasPublishId(crypto.randomUUID());
    if (!observeCredentialPublishId) throw new Error('Expected valid publish ID.');
    await preserveAndPrepare({
      auth,
      assessmentId: assessment.id,
      publishId: observeCredentialPublishId,
      connectionId,
      exportReceipt: exported.receipt,
      bytes: exported.bytes,
      storage,
      requestFingerprint: await sha256Hex(new TextEncoder().encode('observe credential repair')),
    });
    let knownMigrationCreates = 0;
    const rejectedObservation = await advanceCanvasPublish(auth, {
      assessmentId: assessment.id,
      publishId: observeCredentialPublishId,
      storage,
      runtime,
    }, {
      fetchImpl: authorizedCanvasFetch('expired-token', (input, init) => {
        const url = String(input);
        if (url.endsWith('/content_migrations') && init?.method === 'POST') {
          knownMigrationCreates += 1;
          return Promise.resolve(Response.json(canvasMigration(88, 'created', {
            upload_url: 'https://uploads.example.net/observe-credential',
            upload_params: { policy: 'observe-credential' },
          })));
        }
        if (url === 'https://uploads.example.net/observe-credential') {
          return Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { location: 'https://canvas.example.edu/api/v1/files/88/create_success' },
            }),
          );
        }
        if (url.endsWith('/files/88/create_success')) {
          return Promise.resolve(Response.json({ id: 88 }));
        }
        if (url.endsWith('/content_migrations/88')) {
          return Promise.resolve(Response.json({}, { status: 401 }));
        }
        throw new Error(`Unexpected credential-repair request: ${init?.method ?? 'GET'} ${url}`);
      }),
    });
    if (!(rejectedObservation.ok)) expect.unreachable('Expected rejectedObservation.ok');
    expect(rejectedObservation.attempt.state._tag).toStrictEqual('RetryObserve');

    const repairedObservation = await advanceCanvasPublish(auth, {
      assessmentId: assessment.id,
      publishId: observeCredentialPublishId,
      storage,
      runtime,
    }, {
      fetchImpl: authorizedCanvasFetch('rotated-token', (input) => {
        const url = String(input);
        if (url.endsWith('/content_migrations/88')) {
          return Promise.resolve(Response.json(canvasMigration(88, 'importing', null)));
        }
        if (url.endsWith('/api/v1/progress/88')) {
          return Promise.resolve(Response.json({ workflow_state: 'completed', completion: 100 }));
        }
        throw new Error(`Unexpected repaired-observation request: ${url}`);
      }),
    });
    if (!(repairedObservation.ok)) expect.unreachable('Expected repairedObservation.ok');
    expect(repairedObservation.attempt.state._tag).toStrictEqual('Published');
    expect(knownMigrationCreates).toStrictEqual(1);

    const expiredCreatePublishId = parseCanvasPublishId(crypto.randomUUID());
    if (!expiredCreatePublishId) throw new Error('Expected valid publish ID.');
    await preserveAndPrepare({
      auth,
      assessmentId: assessment.id,
      publishId: expiredCreatePublishId,
      connectionId,
      exportReceipt: exported.receipt,
      bytes: exported.bytes,
      storage,
      requestFingerprint: await sha256Hex(new TextEncoder().encode('expired create')),
    });
    const createStartedAt = new Date('2026-08-05T12:00:00.000Z');
    const claimedCreate = await claimCanvasPublishAttempt(
      auth,
      assessment.id,
      expiredCreatePublishId,
      createStartedAt,
      1_000,
    );
    if (!(claimedCreate.ok)) expect.unreachable('Expected claimedCreate.ok');
    const markedCreate = await markCanvasRemoteCreationStarted(auth, {
      assessmentId: assessment.id,
      publishId: expiredCreatePublishId,
      leaseToken: claimedCreate.leaseToken,
      startedAt: createStartedAt,
      leaseDurationMs: 1_000,
    });
    if (!(markedCreate.ok)) expect.unreachable('Expected markedCreate.ok');
    let expiredCreateCalls = 0;
    const expiredCreate = await advanceCanvasPublish(auth, {
      assessmentId: assessment.id,
      publishId: expiredCreatePublishId,
      storage,
      runtime,
    }, {
      now: () => new Date('2026-08-05T12:00:01.001Z'),
      fetchImpl: () => {
        expiredCreateCalls += 1;
        throw new Error('Expired creation must not be reclaimed.');
      },
    });
    if (!(expiredCreate.ok)) expect.unreachable('Expected expiredCreate.ok');
    expect(expiredCreate.attempt.state._tag).toStrictEqual('RemoteIdentityUnknown');
    expect(expiredCreate.attempt.attemptCount).toStrictEqual(1);
    expect(expiredCreateCalls).toStrictEqual(0);

    const changedConnectionPublishId = parseCanvasPublishId(crypto.randomUUID());
    if (!changedConnectionPublishId) throw new Error('Expected valid publish ID.');
    await preserveAndPrepare({
      auth,
      assessmentId: assessment.id,
      publishId: changedConnectionPublishId,
      connectionId,
      exportReceipt: exported.receipt,
      bytes: exported.bytes,
      storage,
      requestFingerprint: await sha256Hex(new TextEncoder().encode('changed connection')),
    });
    await db.update(canvasConnections).set({ baseUrl: 'https://replacement.example.edu' }).where(
      eq(canvasConnections.id, connectionId),
    );
    const changedConnection = await advanceCanvasPublish(auth, {
      assessmentId: assessment.id,
      publishId: changedConnectionPublishId,
      storage,
      runtime,
    }, {
      fetchImpl: authorizedCanvasFetch('test-token', () => {
        throw new Error('Connection drift must fail before Canvas transport.');
      }),
    });
    if (!(changedConnection.ok)) expect.unreachable('Expected changedConnection.ok');
    expect(changedConnection.attempt.state._tag).toStrictEqual('Failed');
    if (changedConnection.attempt.state._tag !== 'Failed') throw new Error('Expected failure.');
    expect(changedConnection.attempt.state.failure.code).toStrictEqual('CanvasConnectionChanged');
    await db.update(canvasConnections).set({ baseUrl: 'https://canvas.example.edu' }).where(
      eq(canvasConnections.id, connectionId),
    );

    const conflict = await prepareCanvasPublishAttempt(auth, {
      publishId: secondPublishId,
      assessmentId: assessment.id,
      connection: {
        id: connectionId,
        name: 'Canvas production',
        baseUrl: 'https://canvas.example.edu',
        supportedTargetIds: ['canvas-classic', 'canvas-new-quizzes'],
      },
      targetId: 'canvas-classic',
      destination: canvasCourseDestination(),
      requestFingerprint: await sha256Hex(new TextEncoder().encode('different request')),
      export: {
        receipt: exported.receipt,
        artifact: recovered.attempt.artifact,
      },
    });
    expect(conflict.ok).toStrictEqual(false);
    if (!conflict.ok) expect(conflict.error._tag).toStrictEqual('CanvasPublishIdempotencyConflict');

    const newQuizzesExport = await exportCanvasPackage(
      auth,
      assessment.id,
      storage,
      'canvas-new-quizzes',
    );
    const newQuizzesPublishId = parseCanvasPublishId(crypto.randomUUID());
    if (!newQuizzesPublishId) throw new Error('Expected valid New Quizzes publish ID.');
    let importIntoNewQuizzes: FormDataEntryValue | null = null;
    const newQuizzesResponse = await invokeHttpRoute(
      createCanvasPublishHandler({
        fetchImpl: successfulCanvasFetch([], (form) => {
          importIntoNewQuizzes = form.get('settings[import_quizzes_next]');
        }),
      }),
      makeHttpRequest(
        new Request(
          `https://qflow.example/api/assessments/${assessment.id}/publish/canvas`,
          {
            ...{ duplex: 'half' },
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': newQuizzesPublishId,
            },
            body: JSON.stringify({
              connectionId,
              targetId: 'canvas-new-quizzes',
              destination: { type: 'course', courseId: '17' },
              preflightId: newQuizzesExport.preflightId,
              acknowledgement: newQuizzesExport.acknowledgement,
              scoring: 'automatic',
              interaction: 'preserve',
            }),
          },
        ),
        { params: { id: assessment.id }, auth, state: { storage, runtime } },
      ),
    );
    expect(newQuizzesResponse.status).toStrictEqual(200);
    expect(importIntoNewQuizzes).toStrictEqual('true');
    const newQuizzesAttempt = await findCanvasPublishAttempt(
      auth,
      assessment.id,
      newQuizzesPublishId,
    );
    if (!(newQuizzesAttempt.ok)) expect.unreachable('Expected newQuizzesAttempt.ok');
    expect(newQuizzesAttempt.attempt.targetId).toStrictEqual('canvas-new-quizzes');
    expect(newQuizzesAttempt.attempt.state._tag).toStrictEqual('Published');
    if (newQuizzesAttempt.attempt.state._tag !== 'Published') {
      throw new Error('Expected a completed New Quizzes publish.');
    }
    expect(newQuizzesAttempt.attempt.state.receipt.targetId).toStrictEqual('canvas-new-quizzes');
    expect(
      Array.from(await readPreservedPackage(auth, assessment.id, newQuizzesPublishId, storage)),
    ).toStrictEqual(Array.from(newQuizzesExport.bytes));
  } finally {
    try {
      await http?.close();
    } finally {
      try {
        await cleanup({ tenantId, userId, assessmentId, questionId });
      } finally {
        await shutdownDb();
      }
    }
  }
});

function singleSelectDraft(): Record<string, unknown> {
  return {
    type: 'single_select',
    title: 'Select one',
    bodyHtml: '<p>Select one.</p>',
    choices: [{ id: 'A', text: 'One' }, { id: 'B', text: 'Two' }],
    correctId: 'A',
  };
}

async function cleanup(input: {
  readonly tenantId: string;
  readonly userId: string;
  readonly assessmentId: string | null;
  readonly questionId: string | null;
}) {
  await deleteCanvasConnectionFixture(input.tenantId);
  if (input.assessmentId) {
    await db.delete(assessmentCanvasPublishAttempts).where(
      eq(assessmentCanvasPublishAttempts.assessmentId, input.assessmentId),
    );
    await db.delete(assessmentExportReceipts).where(
      eq(assessmentExportReceipts.assessmentId, input.assessmentId),
    );
    const parts = await db.select({ id: assessmentParts.id }).from(assessmentParts).where(
      eq(assessmentParts.assessmentId, input.assessmentId),
    );
    for (const part of parts) {
      await db.delete(assessmentPlacements).where(
        eq(assessmentPlacements.assessmentPartId, part.id),
      );
    }
    await db.delete(assessmentParts).where(eq(assessmentParts.assessmentId, input.assessmentId));
    await db.delete(assessments).where(eq(assessments.id, input.assessmentId));
  }
  if (input.questionId) {
    await db.update(questions).set({ latestRevisionId: null }).where(
      eq(questions.id, input.questionId),
    );
    await db.delete(questionRevisions).where(eq(questionRevisions.questionId, input.questionId));
    await db.delete(questions).where(eq(questions.id, input.questionId));
  }
  await db.delete(users).where(eq(users.id, input.userId));
  await db.delete(tenants).where(eq(tenants.id, input.tenantId));
}
