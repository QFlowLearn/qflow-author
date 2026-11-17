import { expect, test as testCase } from 'vitest';

import { parseEnrichmentActionReply } from '../lib/bank_enrichment_client.ts';

testCase(
  'enrichment navigation preserves explicit preview fields and rejects unrelated destinations or parameters',
  () => {
    const path = `/items/organize/${crypto.randomUUID()}`;
    for (
      const url of [
        '/items/organize',
        path,
        `${path}?kind=organization`,
        `${path}?fields=difficulty`,
        `${path}?fields=subject%2Ctopic`,
      ]
    ) {
      expect(parseEnrichmentActionReply({ url })).toStrictEqual({ url });
    }
    for (
      const url of [
        `https://example.com${path}`,
        `/${path}`,
        `${path}#fragment`,
        `${path}?kind=organization&kind=organization`,
        `${path}?kind=organization&fields=topic`,
        `${path}?kind=unknown`,
        `${path}?fields=subject`,
        `${path}?fields=difficulty&fields=topic`,
        `${path}?fields=difficulty&redirect=https://example.com`,
        `${path}?fields=unknown`,
        `${path}?fields=`,
        '/items/organize/------------------------------------',
      ]
    ) expect(parseEnrichmentActionReply({ url })).toStrictEqual(null);
    expect(parseEnrichmentActionReply({ url: path, error: 'ambiguous' })).toStrictEqual(null);
    expect(parseEnrichmentActionReply({ error: 'Try again.' })).toStrictEqual({
      error: 'Try again.',
    });
  },
);
