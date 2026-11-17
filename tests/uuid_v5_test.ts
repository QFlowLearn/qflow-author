import { expect, test as testCase } from 'vitest';

import { uuidV5 } from '../lib/uuid_v5.ts';

testCase('uuidV5: RFC 4122 example (DNS + www.widgets.com)', async () => {
  const DNS_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  const uuid = await uuidV5(DNS_NS, 'www.widgets.com');
  expect(uuid).toStrictEqual('21f7f8de-8051-5b89-8680-0195ef798b6a');
});
