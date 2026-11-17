import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { getDb } from '../lib/db.ts';
import { resolveStorage } from '../lib/storage.ts';
import {
  organizationMemberships,
  tenants,
  uploadsTable,
  users,
  workspacePublicationGrants,
} from '../lib/db/schema.ts';
import { prepareQuestionRevision } from '../lib/question_revision_preparation.ts';
import { saveQuestionRevisionInTransaction } from '../lib/services/questions.ts';
import {
  createBankRelease,
  getBankRelease,
  mutateBankRelease,
} from '../lib/services/bank_releases.ts';
import {
  cleanupReleasePreparation,
  downloadReleaseSource,
  prepareBankRelease,
} from '../lib/services/bank_release_preparation.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import type { RequestContext } from '../lib/tenants.ts';

it('retains and adopts an edition through real workerd R2, then enforces withdrawal', async () => {
  const runtime = { bindings: env };
  const database = getDb(runtime), storage = resolveStorage(runtime);
  const tenantId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    questionId = crypto.randomUUID();
  const ctx: RequestContext = { tenantId, userId, role: 'owner' };
  const deps = { database, storage, now: () => new Date('2026-09-09T12:00:00Z') };
  await database.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'R2 editions' });
  await database.insert(users).values({
    id: userId,
    email: userId + '@example.test',
    emailNormalized: userId + '@example.test',
  });
  await database.insert(organizationMemberships).values({
    id: crypto.randomUUID(),
    tenantId,
    userId,
    role: 'owner',
  });
  await database.insert(workspacePublicationGrants).values({ tenantId, userId, grantedBy: userId });
  const body = {
    ...TYPE_DRIVERS.single_select.defaults(),
    type: 'single_select' as const,
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Retained in R2',
  };
  const uploadId = crypto.randomUUID(), uploadPath = `edition-test/${tenantId}/${uploadId}.png`;
  const media = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  await storage.putObject({ key: uploadPath, data: media, contentType: 'image/png' });
  await database.insert(uploadsTable).values({
    id: uploadId,
    tenantId,
    name: 'figure.png',
    mimeType: 'image/png',
    size: media.length,
    path: uploadPath,
    url: `/uploads/${uploadId}`,
  });
  const qtiXml = exportQti3AssessmentItemXml(
    'single_select',
    prepareDriverDraftForBuild('single_select', body),
  ).replace(
    '</qti-item-body>',
    `<img src="/uploads/${uploadId}" alt="Retained figure"/></qti-item-body>`,
  );
  expect(qtiXml.includes(uploadId)).toBe(true);
  const prepared = await prepareQuestionRevision({
    questionId,
    title: body.title,
    body,
    tags: [],
    qtiXml,
    provenance: { _tag: 'Authored' as const },
    draftState: 'published' as const,
  });
  await database.transaction((tx) => saveQuestionRevisionInTransaction(tx, ctx, prepared));
  const id = crypto.randomUUID();
  expect(
    (await createBankRelease(ctx, {
      id,
      operationId: crypto.randomUUID(),
      label: 'R2 A',
      notes: '',
      collectionIds: [],
      questionIds: [questionId],
    }, deps)).ok,
  ).toBe(true);
  const read = async () => {
    const result = await getBankRelease(ctx, id, deps);
    if (!result.ok) throw new Error(result.code);
    return result.value;
  };
  let release = await read();
  const preparationId = crypto.randomUUID();
  expect(
    (await prepareBankRelease(ctx, {
      releaseId: id,
      version: release.version,
      digest: release.digest,
      preparationId,
    }, deps)).ok,
  ).toBe(true);
  release = await read();
  const operationId = crypto.randomUUID();
  expect(
    (await mutateBankRelease(ctx, {
      releaseId: id,
      operationId,
      version: release.version,
      digest: release.digest,
      action: 'freeze',
      attestation: {
        reason: 'Checked the exact revision',

        overrides: [],
      },
    }, deps)).ok,
  ).toBe(true);
  await storage.deleteObject(uploadPath);
  const download = await downloadReleaseSource(ctx, id, crypto.randomUUID(), deps);
  expect(download.ok).toBe(true);
  if (!download.ok) throw new Error(download.code);
  expect(download.value.sha256).toBe(release.manifest.preparation?.sha256);
  expect(await cleanupReleasePreparation(ctx, preparationId, deps)).toEqual({
    ok: false,
    code: 'frozen',
  });
  expect(
    (await mutateBankRelease(ctx, {
      releaseId: id,
      operationId: crypto.randomUUID(),
      version: release.version,
      digest: release.digest,
      action: 'withdraw',
      reason: 'Withdraw test',
      replacementId: null,
    }, deps)).ok,
  ).toBe(true);
  expect(await downloadReleaseSource(ctx, id, crypto.randomUUID(), deps)).toEqual({
    ok: false,
    code: 'withdrawn',
  });
});
