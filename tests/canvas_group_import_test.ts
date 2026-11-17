import { expect, test } from 'vitest';
import { qti12Adapter } from '../lib/import/adapters/qti12.ts';
import { imsccAdapter } from '../lib/import/adapters/imscc.ts';
import { canvasChoiceXml } from './helpers/canvas_import.ts';
import { canvasCartridge } from './helpers/canvas_cartridge.ts';
import { analyzeImport, expectImportedScore } from './helpers/lms_import.ts';

function groupedQuiz(): string {
  const item = canvasChoiceXml().match(/<item ident=[\s\S]*?<\/item>/)?.[0];
  if (!item) throw new Error('Question fixture is required.');
  return `<questestinterop><assessment ident="QUIZ"><section ident="ROOT">
    <section ident="PICK" title="Random cities"><selection_ordering><selection><selection_number>1</selection_number><selection_extension><points_per_item>9</points_per_item></selection_extension></selection></selection_ordering>
    ${item}${item.replace('ident="CHOICE"', 'ident="SECOND"')}</section>
    <section ident="BANK" title="Remote bank"><selection_ordering><selection><sourcebank_ref>bank_123</sourcebank_ref><selection_number>2</selection_number><selection_extension><points_per_item>4</points_per_item></selection_extension></selection></selection_ordering></section>
    </section></assessment></questestinterop>`;
}
test('Canvas random groups retain membership and disclose selection, point overrides and linked-bank omissions', async () => {
  const source = { filename: 'group.xml', bytes: new TextEncoder().encode(groupedQuiz()) };
  const direct = await qti12Adapter.parse(source);
  const cartridge = await imsccAdapter.parse({
    filename: 'group.imscc',
    bytes: await canvasCartridge({ ccXml: '<questestinterop/>', nativeXml: groupedQuiz() }),
  });
  for (const imported of [direct, cartridge]) {
    expect(imported.items).toHaveLength(2);
    expect(imported.organizationGroups).toHaveLength(1);
    expect(imported.organizationGroups[0].title).toBe('Random cities');
    expect(imported.organizationGroups[0].hrefs).toEqual(imported.items.map((item) => item.href));
    const notices = imported.warnings?.filter((w) => w.code === 'CANVAS_GROUP_SELECTION_REVIEW') ??
      [];
    expect(notices).toHaveLength(2);
    expect(notices[0].message).toContain('select 1 questions; group points per question: 9');
    expect(notices[0].message).toContain('fixed questions with their own item points');
    expect(notices[1].message).toContain('linked bank: bank_123');
    expect(notices[1].message).toContain('Imported 0 available questions');
    expectImportedScore(imported, { RESPONSE: 'A' }, 3);
  }
  const analysis = await analyzeImport(qti12Adapter, direct, source);
  expect(
    (analysis.summary.globalWarnings ?? []).filter((w) =>
      w.code === 'CANVAS_GROUP_SELECTION_REVIEW'
    ),
  ).toHaveLength(
    2,
  );
  expect(analysis.items.every((item) => item.readiness === 'ready')).toBe(true);
});
