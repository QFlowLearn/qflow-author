import { expect } from 'vitest';
import * as _fsSync from 'node:fs';

import type { APIRequestContext } from 'playwright';

/** Require an explicit loopback TLS runtime, matching QA credentials and trusted local CA. */
export function readLocalHarborConfig() {
  const required = (key: string) => {
    const value = process.env[key]?.trim();
    if (!value) expect.unreachable(`${key} is required for the opt-in local integration test.`);
    return value;
  };
  const origin = new URL(required('QFLOW_HARBOR_TEST_ORIGIN'));
  if (!(_fsSync.statSync(required('NODE_EXTRA_CA_CERTS')).isFile())) {
    expect.unreachable('NODE_EXTRA_CA_CERTS must name the local test CA.');
  }
  if (!(origin.protocol === 'https:' && origin.hostname === '127.0.0.1' && origin.port)) {
    expect.unreachable(
      "Expected origin.protocol === 'https:' && origin.hostname === '127.0.0.1' && origin.port",
    );
  }
  if (
    !(origin.pathname === '/' && !origin.search && !origin.hash && !origin.username &&
      !origin.password)
  ) {
    expect.unreachable(
      "Expected origin.pathname === '/' && !origin.search && !origin.hash && !origin.username && !origin.p",
    );
  }
  return {
    origin: origin.origin,
    adminKey: required('QFLOW_HARBOR_TEST_ADMIN_KEY'),
    signingSecret: required('QFLOW_HARBOR_TEST_SIGNING_SECRET'),
    runnerKey: required('QFLOW_HARBOR_TEST_RUNNER_KEY'),
    tenantId: required('QFLOW_HARBOR_TEST_TENANT_ID'),
  };
}

/** Send an actual local Harbor command; HTTP failures preserve their response evidence. */
export async function harborPost(
  request: APIRequestContext,
  harbor: ReturnType<typeof readLocalHarborConfig>,
  path: string,
  data: unknown,
): Promise<unknown> {
  const response = await request.post(`${harbor.origin}${path}`, {
    headers: { 'x-harbor-admin-key': harbor.adminKey },
    data,
  });
  if (!(response.ok())) expect.unreachable(await response.text());
  return await response.json();
}

/** Launch or resume through native Harbor HTTP and project the parsed attempt identity. */
export async function bootstrap(
  request: APIRequestContext,
  harbor: ReturnType<typeof readLocalHarborConfig>,
  accessCode: string,
  actorId: string,
  clientSessionId: string,
) {
  const envelope = await harborPost(request, harbor, '/api/launch/access-code', {
    accessCode,
    actor: { kind: 'access-code-candidate', id: actorId, displayName: 'Local order reader' },
  });
  if (
    !(envelope && typeof envelope === 'object' && 'bootstrapToken' in envelope &&
      typeof envelope.bootstrapToken === 'string')
  ) {
    expect.unreachable(
      "Expected envelope && typeof envelope === 'object' && 'bootstrapToken' in envelope && typeof envelop",
    );
  }
  const value = await harborPost(request, harbor, '/api/bootstrap', {
    bootstrapToken: envelope.bootstrapToken,
    clientSessionId,
  });
  if (
    !(value && typeof value === 'object' && 'attemptId' in value &&
      typeof value.attemptId === 'string' && 'session' in value)
  ) {
    expect.unreachable(
      "Expected value && typeof value === 'object' && 'attemptId' in value && typeof value.attemptId === '",
    );
  }
  const session = value.session;
  if (!(session && typeof session === 'object' && 'currentItemRef' in session)) {
    expect.unreachable(
      "Expected session && typeof session === 'object' && 'currentItemRef' in session",
    );
  }
  const ref = session.currentItemRef;
  if (
    !(ref && typeof ref === 'object' && 'itemId' in ref && typeof ref.itemId === 'string' &&
      'itemHref' in ref && typeof ref.itemHref === 'string')
  ) {
    expect.unreachable(
      "Expected ref && typeof ref === 'object' && 'itemId' in ref && typeof ref.itemId === 'string' && 'it",
    );
  }
  return {
    attemptId: value.attemptId,
    currentItemRef: { itemId: ref.itemId, itemHref: ref.itemHref },
  };
}

/** Parse the real learner inventory and reject mismatched, duplicated or corrupt members. */
export async function readManifest(request: APIRequestContext, origin: string, attemptId: string) {
  const response = await request.get(`${origin}/api/content/manifest?attemptId=${attemptId}`);
  expect(response.status(), await response.text()).toStrictEqual(200);
  const value: unknown = await response.json();
  if (
    !(value && typeof value === 'object' && 'itemOrder' in value &&
      Array.isArray(value.itemOrder) &&
      'items' in value && 'currentItemId' in value && typeof value.currentItemId === 'string')
  ) {
    expect.unreachable(
      "Expected value && typeof value === 'object' && 'itemOrder' in value && Array.isArray(value.itemOrde",
    );
  }
  const itemOrder: string[] = [];
  for (const id of value.itemOrder) {
    if (!(typeof id === 'string')) expect.unreachable("Expected typeof id === 'string'");
    itemOrder.push(id);
  }
  const items: Record<string, { id: string; itemHref: string; title: string; maxScore: number }> =
    {};
  if (!(value.items && typeof value.items === 'object')) {
    expect.unreachable("Expected value.items && typeof value.items === 'object'");
  }
  for (const [id, item] of Object.entries(value.items)) {
    const raw: unknown = item;
    if (
      !(raw && typeof raw === 'object' && 'id' in raw && raw.id === id &&
        'itemHref' in raw && typeof raw.itemHref === 'string' &&
        'title' in raw && typeof raw.title === 'string' && 'maxScore' in raw &&
        typeof raw.maxScore === 'number' && Number.isFinite(raw.maxScore) && raw.maxScore >= 0)
    ) {
      expect.unreachable(
        "Expected raw && typeof raw === 'object' && 'id' in raw && raw.id === id && 'itemHref' in raw && typ",
      );
    }
    items[id] = { id, itemHref: raw.itemHref, title: raw.title, maxScore: raw.maxScore };
  }
  expect(new Set(itemOrder)).toStrictEqual(new Set(Object.keys(items)));
  expect(itemOrder.length).toStrictEqual(Object.keys(items).length);
  if (!(itemOrder.includes(value.currentItemId))) {
    expect.unreachable('Expected itemOrder.includes(value.currentItemId)');
  }
  return { itemOrder, items, currentItemId: value.currentItemId };
}

/** A queued result may be absent or pending; final results retain exact numeric totals. */
export function parseAttemptResult(value: unknown, attemptId: string) {
  if (!(value && typeof value === 'object' && 'rows' in value && Array.isArray(value.rows))) {
    expect.unreachable(
      "Expected value && typeof value === 'object' && 'rows' in value && Array.isArray(value.rows)",
    );
  }
  for (const entry of value.rows) {
    const row: unknown = entry;
    if (!row || typeof row !== 'object' || !('attemptId' in row) || row.attemptId !== attemptId) {
      continue;
    }
    if (!('result' in row)) expect.unreachable("Expected 'result' in row");
    const result = row.result;
    if (result === null) return null;
    if (
      !(result && typeof result === 'object' && 'status' in result && 'totalScore' in result &&
        'maxScore' in result)
    ) {
      expect.unreachable(
        "Expected result && typeof result === 'object' && 'status' in result && 'totalScore' in result && 'm",
      );
    }
    if (
      !(typeof result.status === 'string' &&
        (result.totalScore === null || typeof result.totalScore === 'number') &&
        (result.maxScore === null || typeof result.maxScore === 'number'))
    ) {
      expect.unreachable(
        "Expected typeof result.status === 'string' && (result.totalScore === null || typeof result.totalSco",
      );
    }
    return { status: result.status, totalScore: result.totalScore, maxScore: result.maxScore };
  }
  return null;
}

/** Read actual persisted automatic grades through the instructor's existing result-item view. */
export async function readFinalItemGrades(
  request: APIRequestContext,
  origin: string,
  attemptId: string,
) {
  const response = await request.get(
    `${origin}/api/instructor/manual-scoring/attempts/${attemptId}`,
  );
  expect(response.status()).toStrictEqual(200);
  const value: unknown = await response.json();
  if (
    !(value && typeof value === 'object' && 'attemptId' in value &&
      value.attemptId === attemptId && 'resultStatus' in value &&
      value.resultStatus === 'complete' && 'items' in value && Array.isArray(value.items))
  ) {
    expect.unreachable(
      "Expected value && typeof value === 'object' && 'attemptId' in value && value.attemptId === attemptI",
    );
  }
  const grades = value.items.map((entry: unknown) => {
    if (
      !(entry && typeof entry === 'object' && 'itemId' in entry &&
        typeof entry.itemId === 'string' && 'itemTitle' in entry &&
        typeof entry.itemTitle === 'string' && 'authoredMaxScore' in entry &&
        typeof entry.authoredMaxScore === 'number' && Number.isFinite(entry.authoredMaxScore) &&
        entry.authoredMaxScore >= 0 && 'pendingManualScoring' in entry &&
        entry.pendingManualScoring === false && 'outcomeVariables' in entry &&
        Array.isArray(entry.outcomeVariables))
    ) {
      expect.unreachable(
        "Expected entry && typeof entry === 'object' && 'itemId' in entry && typeof entry.itemId === 'string",
      );
    }
    const scores = entry.outcomeVariables.filter((outcome: unknown) =>
      outcome && typeof outcome === 'object' && 'identifier' in outcome &&
      outcome.identifier === 'SCORE'
    );
    expect(scores.length).toStrictEqual(1);
    const score: unknown = scores[0];
    if (
      !(score && typeof score === 'object' && 'value' in score &&
        typeof score.value === 'number' && Number.isFinite(score.value))
    ) {
      expect.unreachable(
        "Expected score && typeof score === 'object' && 'value' in score && typeof score.value === 'number' ",
      );
    }
    return {
      id: entry.itemId,
      title: entry.itemTitle,
      maxScore: entry.authoredMaxScore,
      score: score.value,
    };
  });
  expect(new Set(grades.map((item) => item.id)).size).toStrictEqual(grades.length);
  return grades;
}
