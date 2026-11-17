import { expect, test as testCase } from 'vitest';

import { publishedCanonicalRevision } from '../lib/assessment_publication_status.ts';
import { createAssessmentCanonicalRevisionId } from '../lib/export/assessment_export_preflight.ts';

testCase('publication comparison binds a revision to its assessment and receipt', () => {
  const hash = 'a'.repeat(64);
  const receipt = {
    schema: 'qflow.export-receipt.v1',
    receiptId: 'receipt-1',
    assessment: { id: 'assessment-1', canonicalRevisionId: hash },
  };
  expect(publishedCanonicalRevision(receipt, 'assessment-1', 'receipt-1')).toStrictEqual(hash);
  expect(publishedCanonicalRevision(receipt, 'another-assessment', 'receipt-1')).toStrictEqual(
    null,
  );
  expect(publishedCanonicalRevision(receipt, 'assessment-1', 'another-receipt')).toStrictEqual(
    null,
  );
  expect(publishedCanonicalRevision(
    { ...receipt, assessment: { id: 'assessment-1', canonicalRevisionId: 'invalid' } },
    'assessment-1',
    'receipt-1',
  )).toStrictEqual(null);
  expect(publishedCanonicalRevision(null, 'assessment-1', 'receipt-1')).toStrictEqual(null);
});

testCase(
  'publication comparison detects assessment and question edits independent of map insertion order',
  async () => {
    const base = {
      assessmentId: 'assessment-1',
      assessmentXml: '<test title="Original"/>',
      itemsXml: { a: '<item>A</item>', b: '<item>B</item>' },
    };
    const hash = await createAssessmentCanonicalRevisionId(base);
    expect(
      await createAssessmentCanonicalRevisionId({
        ...base,
        itemsXml: { b: base.itemsXml.b, a: base.itemsXml.a },
      }),
    ).toStrictEqual(hash);
    expect(
      await createAssessmentCanonicalRevisionId({
        ...base,
        assessmentXml: '<test title="Edited"/>',
      }),
    ).not.toStrictEqual(hash);
    expect(
      await createAssessmentCanonicalRevisionId({
        ...base,
        itemsXml: { ...base.itemsXml, a: '<item>Changed</item>' },
      }),
    ).not.toStrictEqual(hash);
  },
);
