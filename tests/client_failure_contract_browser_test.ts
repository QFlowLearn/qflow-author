import { afterEach, beforeEach, expect, test } from 'vitest';
import { clientBrowser } from './helpers/client_browser.ts';

const testCase = test.skipIf(process.env['QFLOW_BROWSER_TESTS'] !== '1');
let fixture: Awaited<ReturnType<typeof clientBrowser>>;
beforeEach(async () => {
  fixture = await clientBrowser(`
    export { uploadFile, UploadRequestError } from './lib/client/upload_file.ts';
    export { publishDraftRequest, PublishRequestFailure } from './islands/item_editor/useItemEditorPersistence.ts';
  `);
});
afterEach(async () => {
  await fixture?.close();
});

async function upload() {
  return await fixture.page.evaluate(async () => {
    const client: typeof import('../lib/client/upload_file.ts') = Reflect.get(
      window,
      'qflowClient',
    );
    try {
      return { uploaded: await client.uploadFile(new File(['x'], 'x.png')) };
    } catch (cause: unknown) {
      if (!(cause instanceof client.UploadRequestError)) throw cause;
      return { error: { code: cause.code, message: cause.message, params: cause.params } };
    }
  });
}

async function publish() {
  return await fixture.page.evaluate(async () => {
    const client: typeof import('../islands/item_editor/useItemEditorPersistence.ts') = Reflect.get(
      window,
      'qflowClient',
    );
    try {
      return { published: await client.publishDraftRequest('/api/drafts/id/publish', {}) };
    } catch (cause: unknown) {
      if (!(cause instanceof client.PublishRequestFailure)) throw cause;
      return { error: { code: cause.code, issues: cause.issues } };
    }
  });
}

testCase('uploadFile exposes typed coded failures and stable fallbacks over HTTP', async () => {
  fixture.respond(
    Response.json(
      { error: true, code: 'kind_too_large', params: { kind: 'image', maxMebibytes: 8 } },
      { status: 400 },
    ),
  );
  expect(await upload()).toEqual({
    error: {
      code: 'kind_too_large',
      message: 'kind_too_large',
      params: { kind: 'image', maxMebibytes: 8 },
    },
  });
  fixture.respond(
    Response.json({ error: true, code: 'unknown', message: 'secret' }, { status: 500 }),
  );
  expect((await upload()).error).toMatchObject({
    code: 'request_failed',
    message: 'request_failed',
  });
  await fixture.disconnect();
  expect((await upload()).error).toMatchObject({
    code: 'request_failed',
    message: 'request_failed',
  });
  await fixture.reconnect();
  const uploaded = {
    id: 'id',
    name: 'x.png',
    type: 'image/png',
    size: 1,
    url: '/uploads/id',
    createdAt: 'now',
  };
  fixture.respond(Response.json(uploaded, { status: 201 }));
  expect(await upload()).toEqual({ uploaded });
  fixture.respond(Response.json({ id: 'x' }, { status: 201 }));
  expect((await upload()).error).toMatchObject({
    code: 'invalid_response',
    message: 'invalid_response',
  });
});

testCase('publish client parsing omits hostile diagnostics over HTTP', async () => {
  fixture.respond(
    Response.json(
      {
        error: 'invalid_draft',
        message: 'HOSTILE-TOP-LEVEL-MESSAGE',
        issues: [{ field: 'title', message: 'HOSTILE-FIELD-MESSAGE' }],
      },
      { status: 422 },
    ),
  );
  expect(await publish()).toEqual({
    error: { code: 'save_failed', issues: [{ field: 'title', code: 'invalid_field' }] },
  });
  fixture.respond(Response.json({ message: 'HOSTILE-MALFORMED-SUCCESS' }));
  expect((await publish()).error?.code).toBe('save_failed');
  const published = { itemId: 'item-1', rev: 2, identifier: 'q-2' };
  fixture.respond(Response.json(published, { status: 201 }));
  expect(await publish()).toEqual({ published });
});
