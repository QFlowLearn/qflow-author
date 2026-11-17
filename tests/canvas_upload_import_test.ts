import { expect, test } from 'vitest';
import { qti12Adapter } from '../lib/import/adapters/qti12.ts';
import { imsccAdapter } from '../lib/import/adapters/imscc.ts';
import { canvasEssayXml } from './helpers/canvas_import.ts';
import { canvasCartridge } from './helpers/canvas_cartridge.ts';
import { analyzeImport, expectImportedScore } from './helpers/lms_import.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { projectJsonPersistenceObject } from '../lib/canonical_json.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { writeQti3AssessmentItemResult } from '@longsightgroup/qti3-writer';

function canvasUpload(points = '7'): string {
  return canvasEssayXml(points).replace('essay_question', 'file_upload_question')
    .replace(/<response_str[\s\S]*?<\/response_str>/, '');
}
test('Canvas upload submissions await human grading and retain the source point ceiling through reopening and export', async () => {
  for (const points of ['7', '2.5', '0']) {
    const source = {
      filename: 'upload.xml',
      bytes: new TextEncoder().encode(canvasUpload(points)),
    };
    const direct = await qti12Adapter.parse(source);
    const cartridge = await imsccAdapter.parse({
      filename: 'upload.imscc',
      bytes: await canvasCartridge({
        ccXml: '<questestinterop/>',
        nativeXml: canvasUpload(points),
      }),
    });
    for (const imported of [direct, cartridge]) {
      const item = imported.items[0];
      expect(item.draft.type).toBe('upload');
      expect(item.draft.externalScored).toBe('human');
      expect(item.draft.rubricHtml).toContain(`Source maximum: ${points} points`);
      expect(item.draft.bodyHtml).not.toContain('Source maximum');
      expectImportedScore(imported, { RESPONSE: 'submission.pdf' }, null);
      const reopened = parsePersistedDraft(projectJsonPersistenceObject(item.draft), 'upload');
      expect(reopened.externalScored).toBe('human');
      expect(buildQtiPreviewXml(reopened)).toMatchObject({ ok: true });
    }
    expect((await analyzeImport(qti12Adapter, direct, source)).items[0].warnings.map((w) => w.code))
      .toContain('QTI12_MANUAL_POINTS_REVIEW');
  }
});
test('Canvas uploads cannot conceal automatic scoring or invalid source points', async () => {
  for (
    const xml of [
      canvasUpload('-1'),
      canvasUpload('unknown'),
      canvasUpload().replace(
        '</conditionvar>',
        '</conditionvar><setvar varname="SCORE">100</setvar>',
      ),
    ]
  ) {
    const source = { filename: 'upload.xml', bytes: new TextEncoder().encode(xml) };
    const imported = await qti12Adapter.parse(source);
    expect((await analyzeImport(qti12Adapter, imported, source)).items[0].readiness).toBe(
      'blocked',
    );
  }
  expect(
    writeQti3AssessmentItemResult({
      interactionType: 'upload',
      identifier: 'UPLOAD',
      title: 'Upload',
      externalScored: 'human',
      correctResponse: 'file.pdf',
    }).ok,
  ).toBe(false);
});
