import { expect, test } from 'vitest';
import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
import { qti12Adapter } from '../lib/import/adapters/qti12.ts';
import { buildMigrationAnalysis } from '../lib/import/migration_analysis.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { prepareQuestionXmlDownload } from '../lib/export/question_xml_download.ts';
import { canvasEssayXml } from './helpers/canvas_import.ts';
import { parsePersistedDraft } from '../lib/persisted_draft.ts';
import { projectJsonPersistenceObject } from '../lib/canonical_json.ts';

test('Canvas essays retain rich prompts, manual grading and source-point guidance', async () => {
  for (const points of ['5', '2.5', '0']) {
    const source = {
      filename: 'canvas.xml',
      bytes: new TextEncoder().encode(canvasEssayXml(points)),
    };
    const sniff = await qti12Adapter.sniff(source);
    const imported = await qti12Adapter.parse(source);
    const item = imported.items[0];
    expect(item.draft.type).toBe('extended_text');
    expect(item.draft.externalScored).toBe('human');
    expect(item.draft.bodyHtml).toContain('<strong>your reasoning</strong>');
    expect(item.draft.rubricHtml).toContain(`Source maximum: ${points} points`);
    const analysis = buildMigrationAnalysis(
      imported,
      { adapter: qti12Adapter, sniff },
      { _tag: 'Assessment' },
    );
    expect(analysis.items[0].readiness).toBe('minor_review');
    expect(analysis.items[0].warnings.map((warning) => warning.code)).toContain(
      'QTI12_MANUAL_POINTS_REVIEW',
    );
    const reopened = parsePersistedDraft(projectJsonPersistenceObject(item.draft), 'extended_text');
    const preview = buildQtiPreviewXml(reopened);
    const exported = prepareQuestionXmlDownload(reopened, 'canvas-essay');
    if (!preview.ok || !exported.ok) expect.unreachable('Expected usable manual essay');
    for (const xml of [item.xml, preview.xml, exported.xml]) {
      expect(xml).toContain(`Source maximum: ${points} points`);
      expect(xml).not.toContain('<qti-response-processing');
      expect(xml).toContain('external-scored="human"');
      const scored = scoreQtiItemServerSide({
        itemXml: xml,
        trustedResponses: { RESPONSE: 'My reasoning' },
      });
      expect(scored.ok).toBe(true);
      expect(scored.score).toBe(null);
    }
  }
});

test('Canvas manual essays cannot hide automatic scoring or malformed source points', async () => {
  for (
    const xml of [
      canvasEssayXml().replace(
        '</conditionvar>',
        '</conditionvar><setvar varname="SCORE">100</setvar>',
      ),
      canvasEssayXml().replace('<other/>', '<varequal respident="response1">A</varequal>'),
      canvasEssayXml('-3'),
      canvasEssayXml('invalid'),
      canvasEssayXml().replaceAll('response_str', 'response_lid'),
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

test('Common Cartridge manual essay profiles retain their prompt without inventing points', async () => {
  const xml = canvasEssayXml().replace(
    /<itemmetadata>[\s\S]*?<\/itemmetadata>/,
    '<itemmetadata><qtimetadata><qtimetadatafield><fieldlabel>cc_profile</fieldlabel><fieldentry>cc.essay.v0p1</fieldentry></qtimetadatafield><qtimetadatafield><fieldlabel>qmd_computerscored</fieldlabel><fieldentry>No</fieldentry></qtimetadatafield></qtimetadata></itemmetadata>',
  );
  const imported = await qti12Adapter.parse({
    filename: 'essay.xml',
    bytes: new TextEncoder().encode(xml),
  });
  expect(imported.items[0].draft.bodyHtml).toContain('<strong>your reasoning</strong>');
  expect(imported.items[0].draft.externalScored).toBe('human');
  expect(imported.items[0].draft.rubricHtml).toBeUndefined();
});
