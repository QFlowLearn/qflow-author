import { Buffer } from 'node:buffer';
import type { BrowserContext, Route } from 'playwright';
import { uploadBankRoute as uploadHandlerEndpoint } from '../../lib/http/routes/bank_api/upload.ts';
import { uploadContentBankRoute as downloadHandlerEndpoint } from '../../lib/http/routes/bank_api/upload_content.ts';
import type { RequestContext } from '../../lib/tenants.ts';
import type { ObjectStorage } from '../../lib/storage_contract.ts';
import {
  type HttpEndpoint,
  invokeHttpMethod,
  invokeHttpRoute,
  makeHttpRequest,
} from './http_route.ts';

const uploadHandler = uploadHandlerEndpoint.handle;
const downloadHandler = downloadHandlerEndpoint.handle;

/** Keep actual HTTP byte inspection and tenant persistence; substitute only test-owned object storage. */
export async function bindContentUploadStorage(
  context: BrowserContext,
  auth: RequestContext,
  storage: ObjectStorage,
) {
  let uploads = 0;
  async function fulfill(route: Route, response: Response) {
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  }
  await context.route('**/api/uploads', async (route) => {
    const request = route.request(), bytes = request.postDataBuffer();
    if (!bytes) throw new Error('Browser upload has no multipart bytes.');
    const response = await invokeHttpRoute(
      uploadHandler,
      makeHttpRequest(
        new Request(request.url(), {
          ...{ duplex: 'half' },
          method: request.method(),
          headers: request.headers(),
          body: new Uint8Array(bytes),
        }),
        { auth, state: { storage, runtime: { bindings: { QFLOW_UPLOAD_BASE: '/uploads' } } } },
      ),
    );
    if (response.status === 201) uploads++;
    await fulfill(route, response);
  });
  await context.route('**/uploads/*', async (route) => {
    const request = route.request(), id = new URL(request.url()).pathname.split('/').at(-1);
    if (!id) throw new Error('Browser download has no upload identity.');
    // SAFETY: this production route declares the GET method map retained by Fresh's handler union.
    const response = await invokeHttpMethod(
      downloadHandler as HttpEndpoint,
      'GET',
      makeHttpRequest(new Request(request.url(), { headers: request.headers() }), {
        params: { id },
        auth,
        state: { storage },
      }),
    );
    await fulfill(route, response);
  });
  return { uploadedCount: () => uploads };
}
