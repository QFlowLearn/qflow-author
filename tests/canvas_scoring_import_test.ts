import { expect, test } from 'vitest';
import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { qti12Adapter } from '../lib/import/adapters/qti12.ts';
import { buildMigrationAnalysis } from '../lib/import/migration_analysis.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { prepareQuestionXmlDownload } from '../lib/export/question_xml_download.ts';
import { canvasChoiceXml } from './helpers/canvas_import.ts';

test('Canvas percentage scoring retains authored points and answer keys through preview and export', async () => {
  for (const points of [3, 2.5, 0]) {
    for (const type of ['multiple_choice_question', 'true_false_question']) {
      const xml = canvasChoiceXml(String(points)).replace('multiple_choice_question', type);
      const source = { filename: 'canvas.xml', bytes: new TextEncoder().encode(xml) };
      const sniff = await qti12Adapter.sniff(source);
      const imported = await qti12Adapter.parse(source);
      expect(imported.items).toHaveLength(1);
      const item = imported.items[0];
      expect(item.draft).toMatchObject({
        type: 'single_select',
        maximumScore: points,
        correctId: 'A',
      });
      expect(
        buildMigrationAnalysis(imported, { adapter: qti12Adapter, sniff }, { _tag: 'Assessment' })
          .items[0].readiness,
      ).toBe('ready');
      const preview = buildQtiPreviewXml(item.draft);
      const exported = prepareQuestionXmlDownload(item.draft, 'canvas-roundtrip');
      if (!preview.ok || !exported.ok) expect.unreachable('Expected portable Canvas question');
      for (const artifact of [item.xml, preview.xml, exported.xml]) {
        for (const [answer, expected] of [['A', points], ['B', 0], [null, 0]] as const) {
          const grade = scoreQtiItemServerSide({
            itemXml: artifact,
            trustedResponses: { RESPONSE: answer },
          });
          if (!grade.ok) expect.unreachable('Expected valid migrated scoring');
          expect(grade.score).toBe(expected);
        }
      }
    }
  }
});

test('Canvas scoring refuses invalid point metadata and unsupported source programs', async () => {
  const valid = canvasChoiceXml();
  for (
    const xml of [
      ...['', '-1', 'NaN', 'Infinity', 'three'].map(canvasChoiceXml),
      valid.replace('>100</setvar>', '>50</setvar>'),
      valid.replace('maxvalue="100"', 'maxvalue="1"'),
      valid.replace('<varequal respident="response1">A</varequal>', '<other/>'),
      valid.replace(
        '<setvar action="Set" varname="SCORE">100</setvar>',
        '<setvar action="Set" varname="SCORE">100</setvar><setvar varname="EXTRA">1</setvar>',
      ),
      valid.replace('multiple_choice_question', 'unknown_canvas_type'),
    ]
  ) {
    const source = { filename: 'canvas.xml', bytes: new TextEncoder().encode(xml) };
    const sniff = await qti12Adapter.sniff(source);
    const imported = await qti12Adapter.parse(source);
    expect(
      buildMigrationAnalysis(imported, { adapter: qti12Adapter, sniff }, { _tag: 'Assessment' })
        .items[0].readiness,
    ).toBe('blocked');
  }
});
