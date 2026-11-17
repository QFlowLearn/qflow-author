import { expect, test as testCase } from 'vitest';

import { extractCurriculumStandards } from '../lib/standards.ts';

testCase('standards metadata normalizes common authoring shapes', () => {
  const standards = extractCurriculumStandards(
    {
      standards: [
        {
          guid: '370850e6-46fa-11e7-9dcf-6ce999a3c328',
          humanCodingScheme: 'MA.5.FR.1.1',
          fullStatement: 'Add and subtract fractions.',
          caseItemURI:
            'https://case.example.org/ims/case/v1p0/CFItems/370850e6-46fa-11e7-9dcf-6ce999a3c328',
          provider: 'CASE',
        },
        'ELA.6.R.2.1 Explain central idea.',
      ],
    },
    {
      standardAlignments: [
        {
          id: '370850e6-46fa-11e7-9dcf-6ce999a3c328',
          code: 'MA.5.FR.1.1',
          label: 'Duplicate should collapse',
          providerId: 'CASE',
        },
      ],
    },
  );

  expect(standards).toStrictEqual([
    {
      standardId: '370850e6-46fa-11e7-9dcf-6ce999a3c328',
      code: 'MA.5.FR.1.1',
      label: 'Add and subtract fractions.',
      uri: 'https://case.example.org/ims/case/v1p0/CFItems/370850e6-46fa-11e7-9dcf-6ce999a3c328',
      providerId: 'CASE',
      resourceLabel: null,
    },
    {
      standardId: 'ELA.6.R.2.1 Explain central idea.',
      code: 'ELA.6.R.2.1',
      label: 'ELA.6.R.2.1 Explain central idea.',
    },
  ]);
});

testCase('standards metadata normalizes the qti3-core alignment contract', () => {
  const standards = extractCurriculumStandards({
    standards: [{
      identifier: '370850e6-46fa-11e7-9dcf-6ce999a3c328',
      targetName: 'MA.5.FR.1.1',
      text: 'Add and subtract fractions.',
      targetUrl:
        'https://case.example.org/ims/case/v1p0/CFItems/370850e6-46fa-11e7-9dcf-6ce999a3c328',
      providerIdentifier: 'CASE',
    }],
  });

  expect(standards).toStrictEqual([{
    standardId: '370850e6-46fa-11e7-9dcf-6ce999a3c328',
    code: 'MA.5.FR.1.1',
    label: 'MA.5.FR.1.1',
    uri: 'https://case.example.org/ims/case/v1p0/CFItems/370850e6-46fa-11e7-9dcf-6ce999a3c328',
    providerId: 'CASE',
    resourceLabel: null,
  }]);
});
