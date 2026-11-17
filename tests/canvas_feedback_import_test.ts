import { expect, test } from 'vitest';
import { qti12Adapter } from '../lib/import/adapters/qti12.ts';
import { imsccAdapter } from '../lib/import/adapters/imscc.ts';
import { canvasChoiceXml } from './helpers/canvas_import.ts';
import { canvasCartridge } from './helpers/canvas_cartridge.ts';
import { analyzeImport, expectImportedScore } from './helpers/lms_import.ts';
const definition =
  '<itemfeedback ident="correct_fb"><flow_mat><material><mattext texttype="text/html"><![CDATA[Correct<br>because Paris is in France.]]></mattext></material></flow_mat></itemfeedback>';
function withFeedback(): string {
  return canvasChoiceXml().replace(
    '</respcondition>',
    '<displayfeedback feedbacktype="Response" linkrefid="correct_fb"/></respcondition>',
  ).replace(
    '</resprocessing>',
    '<respcondition continue="Yes"><conditionvar><other/></conditionvar><displayfeedback feedbacktype="Response" linkrefid="correct_fb"/></respcondition></resprocessing>',
  ).replace('</item>', `${definition}</item>`);
}
test('Canvas feedback instructions do not reject or change an otherwise supported scoring program', async () => {
  const source = { filename: 'canvas.xml', bytes: new TextEncoder().encode(withFeedback()) };
  const direct = await qti12Adapter.parse(source);
  expect(direct.items[0].draft.type).toBe('single_select');
  expectImportedScore(direct, { RESPONSE: 'A' }, 3);
  expectImportedScore(direct, { RESPONSE: 'B' }, 0);
  const analysis = await analyzeImport(qti12Adapter, direct, source);
  expect(analysis.items[0].warnings.map((warning) => warning.code)).toContain('LMS_CONTENT_REVIEW');
  expect(analysis.items[0].readiness).toBe('minor_review');
  const imported = await imsccAdapter.parse({
    filename: 'feedback.imscc',
    bytes: await canvasCartridge({ ccXml: '<questestinterop/>', nativeXml: withFeedback() }),
  });
  expect(imported.items[0].draft.choices).toHaveLength(2);
  expectImportedScore(imported, { RESPONSE: 'A' }, 3);
});
test('feedback normalization still rejects score-changing, terminating and unresolved source instructions', async () => {
  for (
    const xml of [
      withFeedback().replace('linkrefid="correct_fb"', 'linkrefid="missing"'),
      withFeedback().replace('continue="Yes"', 'continue="No"'),
      withFeedback().replace('</setvar>', '</setvar><setvar varname="EXTRA">1</setvar>'),
    ]
  ) {
    const source = { filename: 'unsafe.xml', bytes: new TextEncoder().encode(xml) };
    const imported = await qti12Adapter.parse(source);
    expect((await analyzeImport(qti12Adapter, imported, source)).items[0].readiness).toBe(
      'blocked',
    );
  }
});
