import { env } from 'cloudflare:workers';
import { introspectWorkflowInstance } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../lib/db.ts';
import { resolveStorage } from '../lib/storage.ts';
import {
  organizationMemberships,
  tenants,
  users,
  workflowDispatches,
  workspacePublicationGrants,
} from '../lib/db/schema.ts';
import { releaseBuildAttempts } from '../lib/db/release_artifact_schema.ts';
import {
  createBankRelease,
  getBankRelease,
  mutateBankRelease,
} from '../lib/services/bank_releases.ts';
import { prepareBankRelease } from '../lib/services/bank_release_preparation.ts';
import { requestReleaseBuild } from '../lib/services/release_artifacts.ts';
import { downloadReleaseArtifact } from '../lib/services/release_artifact_delivery.ts';
import { dispatchWorkflowOutbox } from '../deploy/cloudflare/workflows.entry.ts';
import { prepareQuestionRevision } from '../lib/question_revision_preparation.ts';
import { saveQuestionRevisionInTransaction } from '../lib/services/questions.ts';
import { exportQti3TestItemXml } from '../tests/qti3_writer_test_helpers.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import type { RequestContext } from '../lib/tenants.ts';

it('release Workflow builds retained R2 bytes and superseded instances cannot finalize', async () => {
  const runtime = { bindings: env },
    database = getDb(runtime),
    storage = resolveStorage(runtime),
    deps = { database, storage, now: () => new Date('2026-09-09T23:00:00Z') };
  const tenantId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    questionId = crypto.randomUUID(),
    releaseId = crypto.randomUUID();
  const ctx: RequestContext = { tenantId, userId, role: 'owner' };
  await database.insert(tenants).values({
    id: tenantId,
    slug: tenantId,
    name: 'Workflow artifact',
  });
  await database.insert(users).values({
    id: userId,
    email: `${userId}@example.test`,
    emailNormalized: `${userId}@example.test`,
  });
  await database.insert(organizationMemberships).values({
    id: crypto.randomUUID(),
    tenantId,
    userId,
    role: 'owner',
  });
  await database.insert(workspacePublicationGrants).values({ tenantId, userId, grantedBy: userId });
  const body = {
    type: 'single_select',
    title: 'Workflow proof',
    itemLanguage: newAuthoringItemLanguage(),
    promptHtml: '',
    bodyHtml: '<p>Two plus two?</p>',
    choices: [{ id: 'a', text: 'Three' }, { id: 'b', text: 'Four' }],
    correctId: 'b',
    shuffle: false,
  };
  const revision = await prepareQuestionRevision({
    questionId,
    title: body.title,
    body,
    tags: [],
    qtiXml: exportQti3TestItemXml('single_select', body, { identifier: `item-${questionId}` }),
    provenance: { _tag: 'Authored' as const },
    draftState: 'published' as const,
  });
  await database.transaction((tx) => saveQuestionRevisionInTransaction(tx, ctx, revision));
  expect(
    (await createBankRelease(ctx, {
      id: releaseId,
      operationId: crypto.randomUUID(),
      label: 'Workflow A',
      notes: '',
      questionIds: [questionId],
      collectionIds: [],
    }, deps)).ok,
  ).toBe(true);
  const read = async () => {
    const result = await getBankRelease(ctx, releaseId, deps);
    if (!result.ok) throw new Error(result.code);
    return result.value;
  };
  let release = await read();
  expect(
    (await prepareBankRelease(ctx, {
      releaseId,
      preparationId: crypto.randomUUID(),
      version: release.version,
      digest: release.digest,
    }, deps)).ok,
  ).toBe(true);
  release = await read();
  expect(
    (await mutateBankRelease(ctx, {
      action: 'freeze',
      releaseId,
      operationId: crypto.randomUUID(),
      version: release.version,
      digest: release.digest,
      attestation: { reason: 'Owned runtime fixture', overrides: [] },
    }, deps)).ok,
  ).toBe(true);
  const oldId = crypto.randomUUID(), newId = crypto.randomUUID();
  const old = await requestReleaseBuild(ctx, {
    releaseId,
    attemptId: oldId,
    previousAttemptId: null,
  }, deps);
  expect(old.ok).toBe(true);
  if (!old.ok) throw new Error(old.code);
  expect(
    (await requestReleaseBuild(
      ctx,
      { releaseId, attemptId: newId, previousAttemptId: oldId },
      deps,
    )).ok,
  ).toBe(true);
  // SAFETY: Cloudflare's test configuration provides this concrete Workflow binding.
  const binding = (env as unknown as {
    QFLOW_RELEASE_BUILD_WORKFLOW: Parameters<typeof introspectWorkflowInstance>[0];
  }).QFLOW_RELEASE_BUILD_WORKFLOW;
  const oldInstance = await introspectWorkflowInstance(binding, oldId),
    newInstance = await introspectWorkflowInstance(binding, newId);
  try {
    expect((await dispatchWorkflowOutbox(env)).ok).toBe(true);
    await oldInstance.waitForStatus('complete');
    await newInstance.waitForStatus('complete');
    expect(await oldInstance.getOutput()).toEqual({ _tag: 'NoWork', jobId: oldId });
    expect(await newInstance.getOutput()).toEqual({ _tag: 'Completed', jobId: newId, attempts: 1 });
    expect((await dispatchWorkflowOutbox(env)).ok).toBe(true);
    const [dispatch] = await database.select().from(workflowDispatches).where(
      eq(workflowDispatches.id, newId),
    );
    expect(dispatch.state).toBe('complete');
    const [obsolete] = await database.select().from(releaseBuildAttempts).where(
      eq(releaseBuildAttempts.id, oldId),
    );
    expect(obsolete.state).toBe('failed');
    const downloaded = await downloadReleaseArtifact(
      ctx,
      releaseId,
      old.value,
      crypto.randomUUID(),
      deps,
    );
    expect(downloaded.ok).toBe(true);
    if (!downloaded.ok) throw new Error(downloaded.code);
    expect(new TextDecoder().decode(downloaded.value.bytes)).toContain('qmd_itemtype');
    expect(downloaded.value.receipt.attemptId).toBe(newId);
    expect(
      (await mutateBankRelease(ctx, {
        action: 'withdraw',
        releaseId,
        operationId: crypto.randomUUID(),
        version: release.version,
        digest: release.digest,
        reason: 'Runtime check',
        replacementId: null,
      }, deps)).ok,
    ).toBe(true);
    expect(await downloadReleaseArtifact(ctx, releaseId, old.value, crypto.randomUUID(), deps))
      .toEqual({ ok: false, code: 'withdrawn' });
  } finally {
    await oldInstance.dispose();
    await newInstance.dispose();
  }
});
