import { expect, test as testCase } from 'vitest';

import { unzipSync } from 'fflate';
import { parseQtiPackageEntries } from '../lib/import/adapters/qti3/parse_package.ts';
import { runPartsFromJson } from '../lib/import/migration_run_store.ts';
import { migrationDestinationWarnings } from '../lib/import/migration_destination.ts';
import { qtiOrganizationPackage } from './helpers/qti_organization_package.ts';

async function withInstructions(fragment: string, use = 'instructions', view = 'candidate') {
  const entries = unzipSync(await qtiOrganizationPackage());
  const test = new TextDecoder().decode(entries['tests/assessment.xml']);
  entries['tests/assessment.xml'] = new TextEncoder().encode(test.replace(
    '<qti-assessment-section identifier="physics"',
    `<qti-assessment-section identifier="instructions" title="Instructions" visible="true"><qti-rubric-block view="${view}" use="${use}"><qti-content-body>${fragment}</qti-content-body></qti-rubric-block></qti-assessment-section><qti-assessment-section identifier="physics"`,
  ));
  return await parseQtiPackageEntries(
    Object.entries(entries).map(([path, data]) => ({ path, data })),
  );
}

testCase(
  'candidate instructions retain their mixed position without becoming bank questions',
  async () => {
    const parsed = await withInstructions(
      '<p>  Read &lt;script&gt; literally.<br/>α &amp; β  </p>',
    );
    expect(parsed.items.length).toStrictEqual(2);
    expect(parsed.parts[0].placements).toStrictEqual([
      { href: 'items/cell.xml', refIdentifier: 'cell-ref' },
      {
        content: { kind: 'text', text: '  Read <script> literally.\nα & β  ' },
        refIdentifier: 'instructions',
      },
      { href: 'items/energy.xml', refIdentifier: 'energy-ref' },
    ]);
    expect(parsed.organizationGroups.flatMap((group) => group.hrefs)).toStrictEqual([
      'items/cell.xml',
      'items/energy.xml',
    ]);
    expect(migrationDestinationWarnings({ _tag: 'Assessment' }, parsed)).toStrictEqual([]);
    expect(
      migrationDestinationWarnings({ _tag: 'WorkspaceBank', collectionId: null }, {
        ...parsed,
        parts: [{ ...parsed.parts[0], placements: [parsed.parts[0].placements[1]] }],
      }).map((warning) => [warning.code, warning.path]),
    ).toStrictEqual([['BANK_PART_CONTEXT_UNSUPPORTED', undefined]]);
    expect(
      migrationDestinationWarnings({ _tag: 'WorkspaceBank', collectionId: null }, parsed).map((
        warning,
      ) => [warning.code, warning.path]),
    ).toStrictEqual([
      ['BANK_PART_CONTEXT_UNSUPPORTED', 'items/cell.xml'],
      ['BANK_PART_CONTEXT_UNSUPPORTED', 'items/energy.xml'],
    ]);
    expect(
      (await withInstructions('<p>Private note</p>', 'instructions', 'author')).parts[0].placements
        .length,
    ).toStrictEqual(2);
  },
);

testCase(
  'instructions reject executable, formatted, conditional and stray content instead of losing it',
  async () => {
    for (
      const fragment of [
        '<p><script>bad()</script></p>',
        '<p onclick="bad()">Text</p>',
        '<p><a href="javascript:bad()">Text</a></p>',
        '<p>Text</p>Lost text',
        '<p>First</p><p>Second</p>',
        '<p><qti-printed-variable identifier="SCORE"/></p>',
      ]
    ) {
      await expect(Promise.resolve().then(() => withInstructions(fragment))).rejects.toBeInstanceOf(
        Error,
      );
    }
    await expect(Promise.resolve().then(() => withInstructions('<p>Glossary</p>', 'glossary')))
      .rejects.toBeInstanceOf(Error);
  },
);

testCase('stored mixed import placements parse exact owners and reject invalid content', () => {
  const part = {
    id: 'part',
    title: 'Part',
    options: {},
    placements: [
      { href: 'items/first.xml', refIdentifier: undefined },
      { content: { kind: 'text' as const, text: 'Exact\r\ntext' }, refIdentifier: 'text' },
      { href: 'items/second.xml', refIdentifier: undefined },
    ],
  };
  expect(runPartsFromJson({ parts: [part] })).toStrictEqual([part]);
  for (
    const content of [null, {}, { kind: 'text', text: '' }, {
      kind: 'text',
      text: 'Valid',
      html: '<script/>',
    }]
  ) {
    expect(() => runPartsFromJson({ parts: [{ ...part, placements: [{ content }] }] }))
      .toThrowError(Error);
  }
  expect(() =>
    runPartsFromJson({
      parts: [{
        ...part,
        placements: [{ content: { kind: 'text', text: 'Valid' }, href: 'items/competing.xml' }],
      }],
    })
  ).toThrowError(Error);
});
