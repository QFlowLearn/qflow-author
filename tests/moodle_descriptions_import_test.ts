import { expect, test } from 'vitest';
import { moodleXmlAdapter } from '../lib/import/adapters/moodle_xml.ts';
import { giftAdapter } from '../lib/import/adapters/gift.ts';
import { analyzeImport } from './helpers/lms_import.ts';
import { twoChoices } from './helpers/moodle_second_pass.ts';
test('Moodle XML and GIFT descriptions remain unscored placements without poisoning a question', async () => {
  for (
    const [adapter, text] of [
      [
        moodleXmlAdapter,
        `<quiz><question type="description"><name><text>Read</text></name><questiontext format="html"><text><![CDATA[<p>Read <strong>first</strong>.</p>]]></text></questiontext><defaultgrade>0</defaultgrade></question><question type="multichoice"><name><text>MC</text></name><questiontext format="html"><text>Pick.</text></questiontext>${twoChoices}</question></quiz>`,
      ],
      [
        giftAdapter,
        '::Read::[html]<p>Read <strong>first</strong>.</p>\n\n::MC::Pick.{=Paris ~Berlin}',
      ],
    ] as const
  ) {
    const source = {
      filename: adapter === giftAdapter ? 'moodle.gift' : 'moodle.xml',
      bytes: new TextEncoder().encode(text),
    };
    const imported = await adapter.parse(source);
    const analysis = await analyzeImport(adapter, imported, source);
    expect(imported.items).toHaveLength(1);
    expect(imported.items[0].draft.type).toBe('single_select');
    expect(imported.parts[0].placements[0]).toEqual({
      content: { kind: 'text', text: 'Read first.' },
    });
    expect(imported.parts[0].placements[1]).toEqual({ href: imported.items[0].href });
    expect(imported.organizationGroups[0].hrefs).toEqual([imported.items[0].href]);
    expect(analysis.items[0].readiness).toBe('ready');
    expect(
      analysis.summary.globalWarnings?.some((w) => w.message.includes('Formatting is simplified')),
    ).toBe(true);
  }
});
