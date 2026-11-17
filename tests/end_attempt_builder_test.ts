import { test as testCase } from 'vitest';
import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';
import { assertQtiXmlWellFormed } from './qti_xml_assert.ts';
import { defaultsEndAttempt } from '../lib/types/end_attempt.ts';

testCase('end_attempt export emits end-attempt interaction XML', async () => {
  const draft = defaultsEndAttempt();
  draft.title = 'End Attempt Item';
  draft.responseIdentifier = 'END_ATTEMPT';
  draft.endAttemptTitle = 'Show Hint';
  draft.endAttemptCountAttempt = true;

  const xml = exportQti3TestItemXml('end_attempt', draft, { identifier: 'item-end-attempt-1' });
  if (!xml.includes('<qti-end-attempt-interaction')) {
    throw new Error('missing end-attempt interaction');
  }
  if (!xml.includes('response-identifier="END_ATTEMPT"')) {
    throw new Error('missing response identifier');
  }
  if (!xml.includes('title="Show Hint"')) {
    throw new Error('missing title attribute');
  }
  if (!xml.includes('count-attempt="true"')) {
    throw new Error('missing count-attempt attribute');
  }
  await assertQtiXmlWellFormed(xml);
});
