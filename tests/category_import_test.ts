import { expect, test as testCase } from 'vitest';

import { importedQuestionPlacements } from '../lib/import/types.ts';

import { moodleXmlAdapter } from '../lib/import/adapters/moodle_xml.ts';
import { giftAdapter } from '../lib/import/adapters/gift.ts';
import type { ImportAdapter } from '../lib/import/types.ts';
import { xmlEscape } from '../lib/xml.ts';

const entries = [
  { category: null, title: 'Unlabelled first' },
  { category: 'Biology/Cells', title: 'Biology one' },
  { category: 'Computing/Cells', title: 'Spreadsheet cells' },
  { category: 'Biology/Cells', title: 'Biology two' },
  { category: '', title: 'Unlabelled after reset' },
  { category: 'Uncategorized', title: 'Explicitly named category' },
  {
    category: ('Ångström / 測定 / ' + 'Long category '.repeat(30)).trim(),
    title: 'Unicode long path',
  },
];

for (const format of ['moodle', 'gift'] as const) {
  testCase(
    `${format} category paths survive repeated groups, equal leaf names, resets and reordered input`,
    async () => {
      const adapter: ImportAdapter = format === 'moodle' ? moodleXmlAdapter : giftAdapter;
      const source = (rows: typeof entries) => ({
        filename: format === 'moodle' ? 'bank.xml' : 'bank.txt',
        bytes: new TextEncoder().encode(
          format === 'moodle'
            ? '<quiz>' + rows.map((r) =>
              (r.category === null
                ? ''
                : `<question type="category"><category><text>${
                  xmlEscape(r.category)
                }</text></category></question>`) +
              `<question type="essay"><name><text>${
                xmlEscape(r.title)
              }</text></name><questiontext format="html"><text>Explain.</text></questiontext></question>`
            ).join('') + '</quiz>'
            : rows.map((r) =>
              (r.category === null ? '' : `$CATEGORY: ${r.category}\n\n`) +
              `::${r.title}::Explain. {}`
            ).join('\n\n'),
        ),
      });
      const result = await adapter.parse(source(entries));
      expect(result.items.length).toStrictEqual(entries.length);
      expect(result.parts.map((p) => p.title)).toStrictEqual([
        'Uncategorized',
        'Biology/Cells',
        'Computing/Cells',
        'Uncategorized',
        entries[6].category,
      ]);
      const names = new Map(result.items.map((i) => [i.href, i.title]));
      expect(
        result.parts.map((p) =>
          importedQuestionPlacements(p.placements).map((r) => names.get(r.href))
        ),
      ).toStrictEqual([
        ['Unlabelled first', 'Unlabelled after reset'],
        ['Biology one', 'Biology two'],
        ['Spreadsheet cells'],
        ['Explicitly named category'],
        ['Unicode long path'],
      ]);
      expect(new Set(result.parts.map((p) => p.id)).size).toStrictEqual(5);
      if (!(result.parts.every((p) => p.id.length <= 256))) {
        expect.unreachable('Expected result.parts.every((p) => p.id.length <= 256)');
      }
      const reordered = await adapter.parse(source([entries[2], entries[1]]));
      for (const part of reordered.parts) {
        expect(part.id).toStrictEqual(result.parts.find((p) => p.title === part.title)?.id);
      }
      expect(result.items.map((i) => i.title), 'Question order is retained in the bank item list')
        .toStrictEqual(entries.map((r) => r.title));
    },
  );
}

testCase(
  'GIFT category directives need no blank lines and do not become question text',
  async () => {
    const result = await giftAdapter.parse({
      bytes: new TextEncoder().encode(`$CATEGORY: Biology/Cells
::Cell::Choose the structure. {=Nucleus~Cell wall}
$CATEGORY: Physics/Energy
::Energy::Explain energy conservation. {}
$CATEGORY:
::Unlabelled::Explain. {}`),
    });
    expect(result.parts.map((p) => p.title)).toStrictEqual([
      'Biology/Cells',
      'Physics/Energy',
      'Uncategorized',
    ]);
    expect(result.items.map((i) => i.title)).toStrictEqual(['Cell', 'Energy', 'Unlabelled']);
    if (!(result.items.every((i) => !i.xml.includes('$CATEGORY:')))) {
      expect.unreachable("Expected result.items.every((i) => !i.xml.includes('$CATEGORY:'))");
    }
  },
);
