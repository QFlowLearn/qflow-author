import { expect, test as testCase } from 'vitest';

import { importedQuestionPlacements } from '../lib/import/types.ts';

import { parseQtiPackage } from '../lib/import/adapters/qti3/parse_package.ts';
import { parseImportedOrganizationGroups } from '../lib/import/organization_groups.ts';
import { qtiOrganizationPackage } from './helpers/qti_organization_package.ts';

testCase('nested QTI chapters retain their own paths without becoming delivery parts', async () => {
  const parsed = await parseQtiPackage(await qtiOrganizationPackage());
  expect(parsed.parts.length).toStrictEqual(1);
  expect(parsed.parts[0].id).toStrictEqual('delivery');
  expect(parsed.parts[0].options?.navigationMode).toStrictEqual('nonlinear');
  expect(parsed.parts[0].options?.submissionMode).toStrictEqual('individual');
  expect(parsed.parts[0].options?.timeLimits?.maxTime).toStrictEqual(900);
  expect(importedQuestionPlacements(parsed.parts[0].placements).map((p) => p.href)).toStrictEqual([
    'items/cell.xml',
    'items/energy.xml',
  ]);
  expect(parsed.organizationGroups.map((g) => [g.title, g.hrefs])).toStrictEqual([
    ['Biology / Cells / Practice', ['items/cell.xml']],
    ['Physics / Energy', ['items/energy.xml']],
  ]);
  const reordered = await parseQtiPackage(await qtiOrganizationPackage({ swapped: true }));
  for (const group of reordered.organizationGroups) {
    expect(group.id).toStrictEqual(
      parsed.organizationGroups.find((g) => g.title === group.title)?.id,
    );
    if (!(group.id.length <= 256)) expect.unreachable('Expected group.id.length <= 256');
  }
});

testCase(
  'unnamed QTI wrappers inherit their named ancestor and cross-chapter references remain explicit',
  async () => {
    const parsed = await parseQtiPackage(
      await qtiOrganizationPackage({ unnamed: true, ambiguous: true }),
    );
    expect(parsed.organizationGroups.map((g) => [g.title, g.hrefs])).toStrictEqual([
      ['Biology / Cells', ['items/cell.xml']],
      ['Physics / Energy', ['items/energy.xml', 'items/cell.xml']],
    ]);
    expect(parsed.items.length, 'Repeated placements must not duplicate question content')
      .toStrictEqual(2);
  },
);

testCase(
  'stored organization groups reject malformed identities and do not recover from delivery parts',
  () => {
    for (
      const invalid of [
        undefined,
        {},
        [{ id: 'a', title: 'A', hrefs: [7] }],
        [{ id: 'a', title: 'A', hrefs: [] }, { id: 'a', title: 'B', hrefs: [] }],
      ]
    ) expect(() => parseImportedOrganizationGroups(invalid)).toThrowError(Error);
  },
);
