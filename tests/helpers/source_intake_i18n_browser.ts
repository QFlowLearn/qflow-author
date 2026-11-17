import { startFetchServer } from './fetch_server.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../../lib/i18n/locale.ts';

export const locales: InterfaceLocale[] = ['en-US', 'en-GB', 'es-ES', 'es-419'];
export const batchId = '00000000-0000-4000-8000-0000000000a1';
export const runId = '00000000-0000-4000-8000-0000000000a2';
export const canonicalUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type Scenario = 'resolved' | 'confirmation' | 'unsupported' | 'paste' | 'batch';
export type Capture = {
  locale: InterfaceLocale;
  scenario: Scenario;
  kind: 'inspect' | 'execute';
  purpose: string;
  files: Array<{ name: string; type: string; size: number; text: string }>;
  adapters: Array<{ field: string; value: string }>;
  key: string | null;
  text: string | null;
};

export const createSourceIntakeServer = async (
  bundle: string,
  captures: Capture[],
  navigations: Array<{ locale: InterfaceLocale; scenario: Scenario; pathname: string }>,
) =>
  await startFetchServer(async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/bundle.js') {
      return new Response(bundle, { headers: { 'content-type': 'text/javascript' } });
    }
    const ref = new URL(request.headers.get('referer') ?? request.url);
    const locale = (ref.searchParams.get('locale') ?? 'en-US') as InterfaceLocale;
    const scenario = (ref.searchParams.get('scenario') ?? 'resolved') as Scenario;
    if (url.pathname.startsWith('/imports/')) {
      navigations.push({ locale, scenario, pathname: url.pathname });
      return new Response('target');
    }
    if (url.pathname === '/api/source-intake/inspect') {
      const form = await request.formData();
      const files = form.getAll('files').filter((value): value is File => value instanceof File);
      captures.push({
        locale,
        scenario,
        kind: 'inspect',
        purpose: String(form.get('purpose') ?? ''),
        files: await Promise.all(files.map(async (file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          text: await file.text(),
        }))),
        adapters: [...form.entries()]
          .filter(([name]) => name.startsWith('adapter-'))
          .map(([field, value]) => ({ field, value: String(value) })),
        key: request.headers.get('idempotency-key'),
        text: typeof form.get('text') === 'string' ? String(form.get('text')) : null,
      });
      if (scenario === 'unsupported') {
        return Response.json({
          purpose: String(form.get('purpose') ?? 'recover_existing'),
          inspections: [{
            _tag: 'unsupported',
            sourceName: files[0]?.name ?? 'source',
            message: 'HOSTILE_UPSTREAM_PROSE',
            code: 'unsupported_format',
            suggestedPurpose: 'generate_new',
          }],
        });
      }
      if (scenario === 'confirmation' || scenario === 'batch') {
        const inspections = scenario === 'batch'
          ? files.map((file) => ({
            _tag: 'resolved',
            sourceName: file.name,
            candidate: {
              adapter: { id: 'pdf', version: '1' },
              label: 'PDF',
              confidence: 1,
              reason: 'file_type',
            },
          }))
          : [{
            _tag: 'confirmation_required',
            sourceName: files[0]?.name ?? 'source',
            code: 'confirmation_required',
            message: 'Confirm the source format before continuing.',
            candidates: [
              {
                adapter: { id: 'pdf', version: '1' },
                label: 'PDF',
                confidence: 0.9,
                reason: 'file_type',
              },
              {
                adapter: { id: 'qti21', version: '1' },
                label: 'QTI 2.1',
                confidence: 0.8,
                reason: 'content_match',
              },
            ],
          }];
        return Response.json({
          purpose: String(form.get('purpose') ?? 'recover_existing'),
          inspections,
        });
      }
      return Response.json({
        purpose: String(form.get('purpose') ?? 'recover_existing'),
        inspections: [{
          _tag: 'resolved',
          sourceName: files[0]?.name ?? 'source',
          candidate: {
            adapter: { id: 'pdf', version: '1' },
            label: 'PDF document',
            confidence: 1,
            reason: 'file_type',
          },
        }],
      });
    }
    if (url.pathname === '/api/source-intake/execute') {
      const form = await request.formData();
      captures.push({
        locale,
        scenario,
        kind: 'execute',
        purpose: String(form.get('purpose') ?? ''),
        files: await Promise.all(
          form.getAll('files').filter((value): value is File => value instanceof File)
            .map(async (file) => ({
              name: file.name,
              type: file.type,
              size: file.size,
              text: await file.text(),
            })),
        ),
        adapters: [...form.entries()]
          .filter(([name]) => name.startsWith('adapter-'))
          .map(([field, value]) => ({ field, value: String(value) })),
        key: request.headers.get('idempotency-key'),
        text: typeof form.get('text') === 'string' ? String(form.get('text')) : null,
      });
      if (scenario === 'batch') {
        return Response.json({
          purpose: 'recover_existing',
          batchId,
          runIds: [runId, '00000000-0000-4000-8000-0000000000a3'],
          statusUrl: `/imports/batches/${batchId}`,
          redirectTo: `/imports/batches/${batchId}`,
        });
      }
      return Response.json({
        purpose: String(form.get('purpose') ?? 'recover_existing'),
        batchId,
        runIds: [runId],
        statusUrl: `/imports/batches/${batchId}`,
        redirectTo: `/imports/${runId}`,
      });
    }
    const pageLocale = (url.searchParams.get('locale') ?? 'en-US') as InterfaceLocale;
    const config = {
      destination: { _tag: 'Assessment' as const },
      initialPurpose: 'recover_existing' as const,
      payload: createI18nPayload(pageLocale, catalogForLocale(pageLocale), ['imports']),
    };
    return new Response(
      `<!doctype html><html lang="${pageLocale}"><head><meta charset="utf-8"></head><body><div id="root"></div><script>globalThis.__SOURCE_UNHANDLED__=[];addEventListener('unhandledrejection',e=>globalThis.__SOURCE_UNHANDLED__.push(String(e.reason??'')));globalThis.__SOURCE_ATTEMPTS__={inspect:0,execute:0};const originalFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(input,init)=>{const path=String(input);const key=path.endsWith('/inspect')?'inspect':path.endsWith('/execute')?'execute':null;if(key){globalThis.__SOURCE_ATTEMPTS__[key]++;sessionStorage.setItem('__SOURCE_ATTEMPTS__',JSON.stringify(globalThis.__SOURCE_ATTEMPTS__))};return originalFetch(input,init)};window.__INTAKE_CONFIG__=${
        JSON.stringify(config).replaceAll('<', '\\u003c')
      }</script><script type="module" src="/bundle.js"></script></body></html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  });
