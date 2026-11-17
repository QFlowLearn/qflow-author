import { expect, test as testCase } from 'vitest';

import {
  parseDomainVerificationActionResponse,
  parseDomainVerificationCommand,
  parseDomainVerificationListResponse,
  parseSsoPolicySettingsResponse,
  parseSsoPolicySettingsUpdate,
  projectDomainVerificationResponse,
} from '../lib/http/sso_settings_contract.ts';
import { parseSsoDomain } from '../lib/sso_domain.ts';

testCase('SSO policy HTTP contracts normalize domains and reject undeclared fields', () => {
  const response = parseSsoPolicySettingsResponse({
    loginPolicy: 'prefer_sso',
    domainRoutes: [{ domain: ' Example.EDU. ', provider: 'google' }],
  });
  if (!response) expect.unreachable('Expected response');
  expect(response.domainRoutes[0].domain).toStrictEqual('example.edu');

  expect(parseSsoPolicySettingsResponse({
    loginPolicy: 'prefer_sso',
    domainRoutes: [{ domain: 'example.edu', provider: 'saml' }],
  })).toStrictEqual(null);
  expect(parseSsoPolicySettingsUpdate({ loginPolicy: 'require_sso', unexpected: true }))
    .toStrictEqual(null);
});

testCase('SSO policy update parser returns validated domain routes', () => {
  const update = parseSsoPolicySettingsUpdate({
    loginPolicy: 'require_sso',
    domainRoutes: [{ domain: ' School.ORG ', provider: 'microsoft' }],
  });
  if (!(update?.domainRoutes)) expect.unreachable('Expected update?.domainRoutes');
  expect(update.loginPolicy).toStrictEqual('require_sso');
  expect(update.domainRoutes[0]).toStrictEqual({
    domain: 'school.org',
    provider: 'microsoft',
  });
});

testCase('domain-verification HTTP contracts round-trip projected records', () => {
  const domain = parseSsoDomain('example.edu');
  if (!domain) expect.unreachable('Expected domain');
  const projected = projectDomainVerificationResponse({
    tenantId: 'tenant-1',
    domain,
    verificationToken: 'challenge-token',
    dnsVerifiedAt: new Date('2026-08-13T09:10:11.123Z'),
    httpsVerifiedAt: null,
    verifiedAt: new Date('2026-08-13T09:10:11.123Z'),
    createdAt: null,
    updatedAt: null,
  });

  expect(parseDomainVerificationListResponse({ domains: [projected] })).toStrictEqual({
    domains: [projected],
  });
  expect(parseDomainVerificationActionResponse({ record: projected })).toStrictEqual({
    record: projected,
  });
  expect(parseDomainVerificationActionResponse({
    record: { ...projected, verifiedAt: 'not-a-timestamp' },
  })).toStrictEqual(null);
});

testCase('domain-verification command parser is strict and canonical', () => {
  expect(parseDomainVerificationCommand({ domain: ' Example.EDU. ', action: 'verify_dns' }))
    .toStrictEqual({ domain: 'example.edu', action: 'verify_dns' });
  expect(parseDomainVerificationCommand({
    domain: 'example.edu',
    action: 'verify_dns',
    unexpected: true,
  })).toStrictEqual(null);
  expect(parseDomainVerificationCommand({ domain: 'example.edu', action: 'verify_txt' }))
    .toStrictEqual(null);
});
