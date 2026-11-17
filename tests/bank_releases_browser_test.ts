import { expect, test as testCase } from 'vitest';

import { startFetchServer } from './helpers/fetch_server.ts';
import { builtWorkerBrowserEnvironment } from './helpers/built_worker_environment.ts';
import * as _fs from 'node:fs/promises';
import axe from 'axe-core';

import { db, shutdownDb } from '../lib/db.ts';
import { organizationMemberships, tenants, users } from '../lib/db/schema.ts';
import { setPublicationGrant } from '../lib/services/publication_grants.ts';
import { applyBankCollectionCommand } from '../lib/services/bank_collections.ts';
import { saveQuestionRevisionFixture } from './question_revision_fixture.ts';
import { TYPE_DRIVERS } from '../lib/types/registry.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import { prepareDriverDraftForBuild } from '../lib/types/buildable_driver_draft.ts';
import { exportQti3AssessmentItemXml } from '../lib/types/qti3_authoring.ts';
import { openLocalAppBrowser } from '../tools/local_app_browser.ts';
import { createSession } from '../lib/services/auth_sessions.ts';
import { saveUserSettings } from '../lib/services/user_settings.ts';
import { createInitialUserSettings } from '../lib/settings.ts';
import type { RequestContext } from '../lib/tenants.ts';
import { sha256Hex } from '../lib/sha256.ts';
import { resolveStorage } from '../lib/storage.ts';
import { releasePackagesBrowserRuntime } from './helpers/release_packages_browser_runtime.ts';

testCase('browser creates two editions, compares the correction and blocks withdrawn downloads', {
  skip: process.env['QFLOW_BROWSER_TESTS'] !== '1',
}, async function () {
  const tenantId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    questionId = crypto.randomUUID(),
    collectionId = crypto.randomUUID();
  const auth: RequestContext = { tenantId, userId, role: 'owner' };
  // Real HTTP endpoint exercises the configured S3 storage adapter without a module mock.
  const objects = new Map<string, { bytes: Uint8Array; type: string; hash: string }>();
  const server = await startFetchServer(async (request) => {
    const key = new URL(request.url).pathname;
    if (request.method === 'PUT') {
      if (
        request.headers.get('if-none-match') === '*' && objects.has(key)
      ) return new Response(null, { status: 412 });
      objects.set(key, {
        bytes: new Uint8Array(await request.arrayBuffer()),
        type: request.headers.get('content-type') ?? 'application/octet-stream',
        hash: request.headers.get('x-amz-meta-qflow-sha256') ?? '',
      });
      return new Response(null, { status: 200 });
    }
    if (request.method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    const object = objects.get(key);
    if (!object) return new Response(null, { status: 404 });
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(object.bytes), {
      headers: {
        'content-type': object.type,
        'content-length': String(object.bytes.length),
        'x-amz-meta-qflow-sha256': object.hash,
      },
    });
  });
  let app: Awaited<ReturnType<typeof openLocalAppBrowser>> | null = null;
  let packageRuntime: Awaited<ReturnType<typeof releasePackagesBrowserRuntime>> | null = null;
  try {
    await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Browser editions' });
    await db.insert(users).values({
      id: userId,
      email: userId + '@example.test',
      emailNormalized: userId + '@example.test',
    });
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });
    await saveUserSettings(userId, createInitialUserSettings('en-US'));
    const save = async (revision: number) => {
      const body = {
        ...TYPE_DRIVERS.single_select.defaults(),
        type: 'single_select' as const,
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Genetics question',
        promptHtml: '',
        bodyHtml: '<p>Which choice is correct?</p>',
        shuffle: false,
        correctId: revision === 1 ? 'A' : 'B',
      };
      await saveQuestionRevisionFixture(auth, {
        questionId,
        title: body.title,
        body,
        tags: [],
        qtiXml: exportQti3AssessmentItemXml(
          'single_select',
          prepareDriverDraftForBuild('single_select', body),
        ),
        provenance: revision === 1
          ? { _tag: 'Authored' }
          : { _tag: 'Revision', operation: 'revised', expectedParentRevision: revision - 1 },
        draftState: 'published',
      });
    };
    await save(1);
    if (
      !((await applyBankCollectionCommand(auth, crypto.randomUUID(), {
        _tag: 'Create',
        collectionId,
        name: 'Genetics',
        description: '',
        position: 0,
      })).ok)
    ) {
      expect.unreachable(
        "Expected (await applyBankCollectionCommand(auth, crypto.randomUUID(), { _tag: 'Create', collectionI",
      );
    }
    if (
      !((await applyBankCollectionCommand(auth, crypto.randomUUID(), {
        _tag: 'AddItems',
        collectionId,
        questionIds: [questionId],
      })).ok)
    ) {
      expect.unreachable(
        "Expected (await applyBankCollectionCommand(auth, crypto.randomUUID(), { _tag: 'AddItems', collectio",
      );
    }
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) throw new Error('Test database required.');
    app = await openLocalAppBrowser({
      endpoint: {
        _tag: 'ManagedLocalApp',
        isolation: 'fixture',
        portRange: { first: 5198, lastExclusive: 5208 },
        environment: {
          ...builtWorkerBrowserEnvironment,
          DATABASE_URL: databaseUrl,
          QFLOW_STORAGE_BACKEND: 's3-compatible',
          R2_ENDPOINT: `http://127.0.0.1:${server.port}`,
          R2_ACCESS_KEY_ID: 'test-access',
          R2_SECRET_ACCESS_KEY: 'test-secret',
          R2_BUCKET: 'test-bucket',
          R2_FORCE_PATH_STYLE: 'true',
        },
      },
      headless: true,
    });
    packageRuntime = await releasePackagesBrowserRuntime(
      app.baseUrl,
      auth,
      resolveStorage({
        bindings: {
          QFLOW_STORAGE_BACKEND: 's3-compatible',
          R2_ENDPOINT: `http://127.0.0.1:${server.port}`,
          R2_ACCESS_KEY_ID: 'test-access',
          R2_SECRET_ACCESS_KEY: 'test-secret',
          R2_BUCKET: 'test-bucket',
          R2_FORCE_PATH_STYLE: 'true',
        },
      }),
    );
    const baseUrl = `http://127.0.0.1:${packageRuntime.port}`;
    const context: import('playwright').BrowserContext = await app.newContext({
      authSession: await createSession(auth),
    });
    const page: import('playwright').Page = await context.newPage();
    const denied = await page.goto(app.baseUrl + '/releases/new');
    expect(denied?.status()).toStrictEqual(403);
    await page.getByText(/An administrator must explicitly grant/).waitFor();
    if (!((await setPublicationGrant(auth, userId, 'grant')).ok)) {
      expect.unreachable("Expected (await setPublicationGrant(auth, userId, 'grant')).ok");
    }
    const create = async (label: string) => {
      await page.goto(baseUrl + '/releases/new');
      await page.getByLabel('Edition name (required)', { exact: true }).fill(label);
      await page.getByLabel('Genetics', { exact: true }).check();
      await page.getByRole('button', { name: 'Create edition', exact: true }).click();
      await page.getByRole('heading', { name: label, exact: true }).waitFor();
      const id = new URL(page.url()).pathname.split('/').at(-1);
      if (!id) expect.unreachable('Expected id');
      await page.getByRole('button', { name: 'Prepare retained source', exact: true }).click();
      await page.getByLabel(/I attest all 1 selected revisions/).waitFor();
      expect(await page.getByLabel(/I attest all 1 selected revisions/).isChecked()).toStrictEqual(
        false,
      );
      await page.getByLabel(/I attest all 1 selected revisions/).check();
      await page.getByLabel('Reason (required)', { exact: true }).filter({ visible: true }).fill(
        'Publisher checked the complete edition',
      );
      await page.getByRole('button', {
        name: 'Attest selected revisions and freeze',
        exact: true,
      }).click();
      await page.getByRole('heading', { name: 'Retained edition', exact: true }).waitFor();
      return id;
    };
    const a = await create('Biology A');
    const download = async () => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download retained source', exact: true }).click();
      const file = await pending;
      const path = await file.path();
      if (!path) expect.unreachable('Expected path');
      return await sha256Hex(await _fs.readFile(path));
    };
    const hashA = await download();
    const buildPackage = async () => {
      const responsePromise = page.waitForResponse((response) =>
        response.url().endsWith('/packages') && response.request().method() === 'POST'
      );
      await page.getByRole('button', { name: 'Build Sakai package', exact: true }).click();
      const response = await responsePromise;
      expect(response.status()).toStrictEqual(303);
      const confirmation = page.getByLabel(
        'I accept these warnings for this exact package and destination policy.',
        { exact: true },
      );
      await confirmation.waitFor();
      expect(await confirmation.isChecked()).toStrictEqual(false);
      await confirmation.check();
      await page.getByRole('button', { name: 'Accept warnings and mark Ready', exact: true })
        .click();
      await page.getByRole('button', { name: 'Download Sakai package', exact: true }).waitFor();
    };
    const packageDownload = async () => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download Sakai package', exact: true }).click();
      const path = await (await pending).path();
      if (!path) expect.unreachable('Expected path');
      return await sha256Hex(await _fs.readFile(path));
    };
    await buildPackage();
    const packageHashA = await packageDownload();
    await save(2);
    const b = await create('Biology B');
    await buildPackage();
    if (!((await packageDownload()) !== packageHashA)) {
      expect.unreachable('Expected (await packageDownload()) !== packageHashA');
    }
    await page.getByLabel('Compare with edition', { exact: true }).selectOption(a);
    await page.getByRole('button', { name: 'Compare editions', exact: true }).click();
    await page.getByRole('heading', { name: 'Biology B → Biology A', exact: true }).waitFor();
    await page.getByRole('link', { name: /Genetics question.*2.*1/ }).waitFor();
    await page.goto(baseUrl + `/releases/${a}`);
    expect(await download()).toStrictEqual(hashA);
    expect(await packageDownload()).toStrictEqual(packageHashA);
    await page.getByText('Withdraw edition', { exact: true }).first().click();
    await page.getByLabel('Reason (required)', { exact: true }).filter({ visible: true }).fill(
      'Use Biology B',
    );
    await page.getByRole('button', { name: 'Withdraw edition', exact: true }).click();
    await page.getByText('Withdrawn — do not use', { exact: true }).first().waitFor();
    expect(
      await page.getByRole('button', { name: 'Download retained source', exact: true }).count(),
    ).toStrictEqual(0);
    expect(await page.getByRole('button', { name: 'Download Sakai package', exact: true }).count())
      .toStrictEqual(0);
    const blocked = await context.request.post(app.baseUrl + `/releases/${a}/source`, {
      form: { operationId: crypto.randomUUID() },
      headers: { origin: app.baseUrl },
    });
    expect(blocked.status()).toStrictEqual(409);
    await page.screenshot({ path: '/tmp/qflow-step05-withdrawn.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(app.baseUrl + `/releases/${b}`);
    await page.screenshot({ path: '/tmp/qflow-step05-mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > globalThis.innerWidth))
      .toStrictEqual(false);
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      // SAFETY: axe.source was injected into this isolated browser page immediately above.
      const audit = await (globalThis as unknown as {
        axe: {
          run: (
            root: Document,
            options: unknown,
          ) => Promise<{ violations: { id: string; impact: string }[] }>;
        };
      }).axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
      return audit.violations.filter((row) => row.impact === 'serious' || row.impact === 'critical')
        .map((row) => row.id);
    });
    expect(violations).toStrictEqual([]);
    await page.waitForLoadState('networkidle');
    await context.close();
  } finally {
    await app?.close();
    await packageRuntime?.close();
    await server.close();
    await shutdownDb();
  }
});
