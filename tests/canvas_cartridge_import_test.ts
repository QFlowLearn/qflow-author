import { expect, test } from 'vitest';
import { imsccAdapter } from '../lib/import/adapters/imscc.ts';
import { buildMigrationAnalysis } from '../lib/import/migration_analysis.ts';
import { canvasChoiceXml, canvasEssayXml } from './helpers/canvas_import.ts';
import { canvasCartridge } from './helpers/canvas_cartridge.ts';

const emptyShell =
  '<questestinterop><assessment ident="QUIZ" title="Empty compatibility shell"/></questestinterop>';

test('Canvas Classic and New Quizzes select the declared native question rendition exactly once', async () => {
  for (const nativeExtension of ['.xml', '.xml.qti'] as const) {
    for (const ccXml of [emptyShell, canvasChoiceXml('9')]) {
      const source = {
        filename: 'canvas.imscc',
        bytes: await canvasCartridge({ ccXml, nativeXml: canvasChoiceXml('3'), nativeExtension }),
      };
      const sniff = await imsccAdapter.sniff(source);
      expect(sniff.supported).toBe(true);
      const imported = await imsccAdapter.parse(source);
      expect(imported.items).toHaveLength(1);
      expect(imported.items[0].draft).toMatchObject({
        type: 'single_select',
        maximumScore: 3,
        correctId: 'A',
      });
      expect(imported.items[0].href).toContain('non_cc_assessments/QUIZ');
      expect(imported.warnings?.map((warning) => warning.code)).toContain(
        'CANVAS_ASSESSMENT_SETTINGS_REVIEW',
      );
      expect(
        buildMigrationAnalysis(imported, { adapter: imsccAdapter, sniff }, { _tag: 'Assessment' })
          .items[0].readiness,
      ).not.toBe('blocked');
    }
  }
});

test('a broken declared native payload cannot silently switch to the reduced CC rendition', async () => {
  for (
    const input of [
      { nativeXml: '<quiz/>', omitNativeFile: false },
      { nativeXml: canvasChoiceXml('3'), omitNativeFile: true },
    ]
  ) {
    const bytes = await canvasCartridge({ ccXml: canvasChoiceXml('9'), ...input });
    await expect(imsccAdapter.parse({ filename: 'broken.imscc', bytes })).rejects.toThrow(
      'No assessment items',
    );
  }
});

test('cartridge essays retain manual grading and item-owned review notices', async () => {
  const source = {
    filename: 'essays.imscc',
    bytes: await canvasCartridge({ ccXml: emptyShell, nativeXml: canvasEssayXml('5') }),
  };
  const imported = await imsccAdapter.parse(source);
  const analysis = buildMigrationAnalysis(imported, {
    adapter: imsccAdapter,
    sniff: await imsccAdapter.sniff(source),
  }, { _tag: 'Assessment' });
  expect(analysis.items[0].importedDraft.externalScored).toBe('human');
  expect(analysis.items[0].readiness).toBe('minor_review');
  expect(analysis.items[0].warnings.map((warning) => warning.code)).toContain(
    'QTI12_MANUAL_POINTS_REVIEW',
  );
});

test('native multi-question review notices stay attached to their questions', async () => {
  const first = canvasEssayXml('5');
  const secondItem = canvasEssayXml('7').match(/<item[\s\S]*<\/item>/)?.[0];
  expect(secondItem).toBeDefined();
  const nativeXml = first.replace(
    '</section>',
    `${secondItem?.replaceAll('ESSAY', 'ESSAY_TWO')}</section>`,
  );
  const source = {
    filename: 'essays.imscc',
    bytes: await canvasCartridge({ ccXml: emptyShell, nativeXml }),
  };
  const imported = await imsccAdapter.parse(source);
  const analysis = buildMigrationAnalysis(imported, {
    adapter: imsccAdapter,
    sniff: await imsccAdapter.sniff(source),
  }, { _tag: 'Assessment' });
  expect(analysis.items).toHaveLength(2);
  for (const item of analysis.items) {
    expect(item.warnings.map((warning) => warning.code)).toContain('QTI12_MANUAL_POINTS_REVIEW');
  }
  expect(analysis.summary.globalWarnings?.map((warning) => warning.code)).toContain(
    'CANVAS_ASSESSMENT_SETTINGS_REVIEW',
  );
});
