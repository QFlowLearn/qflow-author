import { resolve } from 'node:path';
import { build } from 'esbuild';
import { startBuiltWorker } from '../../tools/start_built_worker.ts';
import { describe, expect, it } from 'vitest';

describe('production DNS adapter under workerd', () => {
  it('uses named TXT/A/AAAA resolvers against a controlled DNS-over-HTTPS fixture', async () => {
    const output = await build({
      stdin: {
        contents:
          `import { resolveDomainTxt, resolveDomainAddresses } from './lib/adapters/domain_dns.ts';
          import { safeErrorSummary } from './lib/error_summary.ts'; export default { async fetch() { try { return Response.json({
            txt: await resolveDomainTxt('qflow-dns.example.test'),
            ipv4: await resolveDomainAddresses('qflow-dns.example.test', 'A'),
            ipv6: await resolveDomainAddresses('qflow-dns.example.test', 'AAAA'),
          }); } catch (cause) { return Response.json({ error: safeErrorSummary(cause), code: cause && typeof cause === 'object' ? cause.code : null }); } } };`,
        resolveDir: resolve('.'),
        sourcefile: 'dns-adapter-fixture.ts',
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      external: ['node:dns/promises'],
    });
    const file = output.outputFiles[0];
    if (!file) throw new Error('DNS smoke bundle missing.');
    const requests: { name: string | null; type: string | null }[] = [];
    const runtime = await startBuiltWorker({
      mode: 'qa',
      databaseUrl: null,
      workerOverrides: {
        workflows: {},
        scriptPath: undefined,
        script: file.text,
        outboundService: (request) => {
          const url = new URL(request.url);
          const name = url.searchParams.get('name');
          const type = url.searchParams.get('type');
          requests.push({ name, type });
          if (url.protocol !== 'https:' || name !== 'qflow-dns.example.test') {
            return new Response(null, { status: 403 });
          }
          const types: Record<string, { type: number; data: string }> = {
            TXT: { type: 16, data: '"qflow-domain-""verification=owned"' },
            A: { type: 1, data: '203.0.113.10' },
            AAAA: { type: 28, data: '2001:db8::10' },
          };
          const answer = type === null ? undefined : types[type];
          if (!answer) return new Response(null, { status: 400 });
          return Response.json({
            Status: 0,
            TC: false,
            RD: true,
            RA: true,
            AD: false,
            CD: false,
            Question: [{ name, type: answer.type }],
            Answer: [{ name, TTL: 60, ...answer }],
            Authority: [],
          });
        },
      },
    });
    try {
      const response = await runtime.dispatchFetch('https://qflow.example/');
      const data = await response.json();
      expect({ status: response.status, requests, data }).toEqual({
        status: 200,
        data: {
          txt: [['qflow-domain-', 'verification=owned']],
          ipv4: ['203.0.113.10'],
          ipv6: ['2001:db8::10'],
        },
        requests: [{ name: 'qflow-dns.example.test', type: 'TXT' }, {
          name: 'qflow-dns.example.test',
          type: 'A',
        }, { name: 'qflow-dns.example.test', type: 'AAAA' }],
      });
      expect(requests).toEqual([
        { name: 'qflow-dns.example.test', type: 'TXT' },
        { name: 'qflow-dns.example.test', type: 'A' },
        { name: 'qflow-dns.example.test', type: 'AAAA' },
      ]);
    } finally {
      await runtime.dispose();
    }
  });
});
