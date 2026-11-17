import { expect } from 'vitest';
import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { moodleXmlAdapter } from '../../lib/import/adapters/moodle_xml.ts';
import { buildMigrationAnalysis } from '../../lib/import/migration_analysis.ts';
import { buildQtiPreviewXml } from '../../lib/qti_preview.ts';
import { prepareQuestionXmlDownload } from '../../lib/export/question_xml_download.ts';
import type { ImportAdapter, ImportResult } from '../../lib/import/types.ts';

/** Original producer-shaped examples, independent of Moodle implementation and fixtures. */
export function moodleQuestion(type: string, extra: string, title = 'Question'): string {
  return `<question type="${type}"><name><text>${title}</text></name><questiontext format="html"><text><![CDATA[<p>Source prompt.</p>]]></text></questiontext>${extra}</question>`;
}
export const moodleChoices =
  '<single>true</single><answer fraction="100"><text>Paris</text></answer><answer fraction="0"><text>Berlin</text></answer>';
export async function importMoodle(questions: string) {
  const source = {
    filename: 'moodle.xml',
    bytes: new TextEncoder().encode(`<quiz>${questions}</quiz>`),
  };
  const imported = await moodleXmlAdapter.parse(source);
  return { imported, analysis: await analyzeImport(moodleXmlAdapter, imported, source) };
}
export async function analyzeImport(
  adapter: ImportAdapter,
  imported: ImportResult,
  source: { filename: string; bytes: Uint8Array },
) {
  return buildMigrationAnalysis(
    imported,
    { adapter, sniff: await adapter.sniff(source) },
    { _tag: 'Assessment' },
  );
}
/** Exercise the imported XML and both authoring derivatives through the real scorer. */
export function expectImportedScore(
  imported: ImportResult,
  response: Record<string, string | number | string[]>,
  expected: number | null,
): void {
  const item = imported.items[0];
  const preview = buildQtiPreviewXml(item.draft);
  const exported = prepareQuestionXmlDownload(item.draft, item.identifier);
  if (!preview.ok || !exported.ok) expect.unreachable('Expected usable preview and export');
  for (const xml of [item.xml, preview.xml, exported.xml]) {
    const result = scoreQtiItemServerSide({ itemXml: xml, trustedResponses: response });
    expect(result.ok).toBe(true);
    expect(result.score).toBe(expected);
  }
}
