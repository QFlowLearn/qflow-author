import type { FetchFixtureServer } from './fetch_server.ts';
import { startFetchServer } from './fetch_server.ts';
import { catalogForLocale } from '../../lib/i18n/catalogs.ts';
import { createI18nPayload } from '../../lib/i18n/payload.ts';
import type { InterfaceLocale } from '../../lib/i18n/locale.ts';
import {
  bodyFor,
  type Capture,
  type Code,
  hostile,
  malformedBody,
  type Scenario,
} from './source_intake_failure_cases.ts';

export const createSourceIntakeFailureServer = async (
  bundle: string,
  captures: Capture[],
  navigations: Array<{ locale: InterfaceLocale; scenario: Scenario; pathname: string }>,
  executeAttempts: Map<string, number>,
  inspectAttempts: Map<string, number>,
): Promise<FetchFixtureServer> => {
  const scenarioOf = (request: Request) => {
    const url = new URL(
      request.headers.get('referer') ?? 'http://local/?locale=en-US&scenario=malformed',
    );
    return {
      locale: (url.searchParams.get('locale') ?? 'en-US') as InterfaceLocale,
      scenario: (url.searchParams.get('scenario') ?? 'malformed') as Scenario,
    };
  };
  return await startFetchServer(async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/bundle.js') {
      return new Response(bundle, { headers: { 'content-type': 'text/javascript' } });
    }
    if (url.pathname.startsWith('/imports/')) {
      const { locale, scenario } = scenarioOf(request);
      navigations.push({ locale, scenario, pathname: url.pathname });
      return new Response('target');
    }
    const { locale, scenario } = scenarioOf(request);
    const renderLocale = (url.searchParams.get('locale') ?? locale) as InterfaceLocale;
    if (url.pathname.endsWith('/inspect') || url.pathname.endsWith('/execute')) {
      const form = await request.formData();
      const kind = url.pathname.endsWith('/inspect') ? 'inspect' : 'execute';
      const files = await Promise.all(
        form.getAll('files').filter((value): value is File => value instanceof File).map(async (
          file,
        ) => ({ name: file.name, type: file.type, size: file.size, text: await file.text() })),
      );
      captures.push({
        locale,
        scenario,
        kind,
        purpose: String(form.get('purpose') ?? ''),
        files,
        adapters: [...form.entries()].filter(([field]) => field.startsWith('adapter-')).map((
          [field, value],
        ) => ({ field, value: String(value) })),
        key: request.headers.get('idempotency-key'),
        text: typeof form.get('text') === 'string' ? String(form.get('text')) : null,
      });
      if (kind === 'inspect') {
        if (scenario === 'inspect-retry') {
          const attemptKey = `${locale}:${scenario}`;
          const attempt = (inspectAttempts.get(attemptKey) ?? 0) + 1;
          inspectAttempts.set(attemptKey, attempt);
          if (attempt === 1) {
            return Response.json({ code: 'source_too_large', message: hostile }, { status: 500 });
          }
          return Response.json({
            purpose: 'recover_existing',
            inspections: [{
              _tag: 'resolved',
              sourceName: 'retry-inspect Ω.pdf',
              candidate: {
                adapter: { id: 'pdf', version: '1' },
                label: 'PDF document',
                confidence: 1,
                reason: 'file_type',
              },
            }],
          });
        }
        if (scenario === 'invalid-json' || scenario === 'inspect-invalid-json-500') {
          return new Response('{', {
            status: 500,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (scenario === 'malformed') return Response.json(bodyFor(scenario), { status: 500 });
        if (scenario.startsWith('inspect-')) {
          const malformed = malformedBody(scenario, kind);
          return typeof malformed === 'string'
            ? new Response(malformed, {
              status: scenario === 'inspect-invalid-json-200' ? 200 : 500,
            })
            : Response.json(malformed, {
              status: scenario === 'inspect-wrong-purpose' || scenario === 'inspect-wrong-count' ||
                  scenario === 'inspect-poisoned-200' ||
                  scenario === 'inspect-unknown-adapter-200'
                ? 200
                : 500,
            });
        }
        if (!scenario.startsWith('execute-')) {
          return Response.json(bodyFor(scenario), { status: 400 });
        }
        return Response.json({
          purpose: 'recover_existing',
          inspections: [{
            _tag: 'resolved',
            sourceName: 'execute Ω.pdf',
            candidate: {
              adapter: { id: 'pdf', version: '1' },
              label: 'PDF document',
              confidence: 1,
              reason: 'file_type',
            },
          }],
        });
      }
      if (kind === 'execute' && scenario.startsWith('execute-')) {
        if (scenario === 'execute-retry') {
          const attemptKey = `${locale}:${scenario}`;
          const attempt = (executeAttempts.get(attemptKey) ?? 0) + 1;
          executeAttempts.set(attemptKey, attempt);
          if (attempt === 1) return Response.json({ message: hostile }, { status: 500 });
          return Response.json({
            purpose: 'recover_existing',
            batchId: '00000000-0000-4000-8000-0000000000a1',
            runIds: ['00000000-0000-4000-8000-0000000000a2'],
            statusUrl: '/imports/batches/00000000-0000-4000-8000-0000000000a1',
            redirectTo: '/imports/00000000-0000-4000-8000-0000000000a2',
          });
        }
        const code = scenario.slice(8) as Code;
        if (
          scenario === 'execute-malformed' || scenario === 'execute-message' ||
          scenario === 'execute-extra' ||
          scenario === 'execute-unknown' || scenario === 'execute-missing-limit' ||
          scenario === 'execute-wrong-limit' ||
          scenario === 'execute-limit-zero' || scenario === 'execute-params-extra' ||
          scenario === 'execute-invalid-json-500' || scenario === 'execute-invalid-json-200' ||
          scenario === 'execute-extra-success-200' ||
          scenario === 'execute-wrong-purpose-200'
        ) {
          const malformed = malformedBody(scenario, kind);
          return typeof malformed === 'string'
            ? new Response(malformed, {
              status: scenario === 'execute-invalid-json-200' ? 200 : 500,
            })
            : Response.json(malformed, {
              status: scenario === 'execute-wrong-purpose-200' ||
                  scenario === 'execute-extra-success-200'
                ? 200
                : 500,
            });
        }
        return Response.json(bodyFor(code), { status: 409 });
      }
      return Response.json({
        purpose: 'recover_existing',
        batchId: '00000000-0000-4000-8000-0000000000a1',
        runIds: ['00000000-0000-4000-8000-0000000000a2'],
        statusUrl: '/imports/batches/00000000-0000-4000-8000-0000000000a1',
        redirectTo: '/imports/00000000-0000-4000-8000-0000000000a2',
      });
    }
    const cfg = {
      destination: { _tag: 'Assessment' as const },
      initialPurpose: 'recover_existing' as const,
      payload: createI18nPayload(renderLocale, catalogForLocale(renderLocale), ['imports']),
    };
    return new Response(
      `<!doctype html><html lang="${renderLocale}"><body><div id="root"></div><script>globalThis.__SOURCE_UNHANDLED__=[];addEventListener('unhandledrejection',e=>globalThis.__SOURCE_UNHANDLED__.push(String(e.reason??'')));window.cfg=${
        JSON.stringify(cfg).replaceAll('<', '\\u003c')
      };{globalThis.__SOURCE_ATTEMPTS__={inspect:0,execute:0};sessionStorage.setItem('__SOURCE_ATTEMPTS_PERSISTED__',JSON.stringify(globalThis.__SOURCE_ATTEMPTS__));const s=new URL(location.href).searchParams.get('scenario');const f=globalThis.fetch.bind(globalThis);globalThis.fetch=(input,init)=>{const u=String(input);const k=u.endsWith('/inspect')?'inspect':u.endsWith('/execute')?'execute':null;if(k){globalThis.__SOURCE_ATTEMPTS__[k]++;sessionStorage.setItem('__SOURCE_ATTEMPTS_PERSISTED__',JSON.stringify(globalThis.__SOURCE_ATTEMPTS__));}if((s==='inspect-network'&&k==='inspect')||(s==='execute-network'&&k==='execute'))return Promise.reject(new TypeError('network'));return f(input,init);};}</script><script type="module" src="/bundle.js"></script></body></html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  });
};
