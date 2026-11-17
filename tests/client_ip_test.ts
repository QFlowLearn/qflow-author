import { expect, test as testCase } from 'vitest';

import { readClientIp } from '../deploy/cloudflare/client_address.ts';

testCase('edge client IP requires platform request metadata and rejects forwarded values', () => {
  const request = new Request('https://app.example.test', {
    headers: { 'cf-connecting-ip': ' 203.0.113.17 ', 'x-forwarded-for': '198.51.100.44' },
  });
  expect(readClientIp(request, 'CloudflareEdge')).toStrictEqual(null);
  // The execution host attaches this property; an HTTP caller cannot send it as a header.
  Object.defineProperty(request, 'cf', { value: { colo: 'IAD' } });
  expect(readClientIp(request, 'CloudflareEdge')).toStrictEqual('203.0.113.17');
  expect(readClientIp(request, 'Local')).toStrictEqual(null);
  const forwarded = new Request('https://app.example.test', {
    headers: { 'x-forwarded-for': '198.51.100.44' },
  });
  Object.defineProperty(forwarded, 'cf', { value: { colo: 'IAD' } });
  expect(readClientIp(forwarded, 'CloudflareEdge')).toStrictEqual(null);
});
testCase(
  'local ingress ignores Cloudflare and forwarded headers even when metadata is synthesized',
  () => {
    const request = new Request('http://127.0.0.1', {
      headers: { 'cf-connecting-ip': '203.0.113.17', 'x-forwarded-for': '198.51.100.44' },
    });
    Object.defineProperty(request, 'cf', { value: { colo: 'LOCAL' } });
    expect(readClientIp(request, 'Local')).toStrictEqual(null);
  },
);
