import { expect, test as testCase } from 'vitest';

import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';

testCase('QTI XML assertion rejects malformed XML', async () => {
  await expect(Promise.resolve().then(() => assertQtiXmlWellFormed('<qti-assessment-item>')))
    .rejects.toBeInstanceOf(Error);
});
