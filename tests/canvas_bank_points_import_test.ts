import { expect, test } from 'vitest';
import { qti12Adapter } from '../lib/import/adapters/qti12.ts';
import { imsccAdapter } from '../lib/import/adapters/imscc.ts';
import { canvasChoiceXml } from './helpers/canvas_import.ts';
import { writeZip } from '../lib/zip.ts';
import { analyzeImport, expectImportedScore } from './helpers/lms_import.ts';
import { withBankReviewSource } from './helpers/bank_review_import.ts';
import { getMigrationReviewPage } from '../lib/services/migration_review_page.ts';
import { updateMigrationItems } from '../lib/import/migration_run_review.ts';

function bankXml(points = ''): string {
  return canvasChoiceXml(points).replace(
    /<assessment[^>]*><section[^>]*>/,
    '<objectbank ident="BANK">',
  )
    .replace('</section></assessment>', '</objectbank>');
}
const encode = (value: string) => new TextEncoder().encode(value);
test('unassigned Canvas bank points retain usable question content and require point assignment', async () => {
  for (
    const xml of [
      bankXml(),
      bankXml().replace(
        /<qtimetadatafield><fieldlabel>points_possible[\s\S]*?<\/qtimetadatafield>/,
        '',
      ),
    ]
  ) {
    const source = { filename: 'bank.xml', bytes: encode(xml) };
    const direct = await qti12Adapter.parse(source);
    const path = 'non_cc_assessments/BANK.xml.qti';
    const cartridgeSource = {
      filename: 'bank.imscc',
      bytes: await writeZip([
        {
          name: 'imsmanifest.xml',
          data: encode(
            `<manifest xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1"><resources><resource identifier="BANK" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="${path}"><file href="${path}"/></resource></resources></manifest>`,
          ),
        },
        { name: path, data: encode(xml) },
      ]),
    };
    const cartridge = await imsccAdapter.parse(cartridgeSource);
    for (const imported of [direct, cartridge]) {
      expect(imported.items).toHaveLength(1);
      expect(imported.items[0].draft).toMatchObject({
        type: 'single_select',
        correctId: 'A',
        maximumScore: 100,
      });
      expect(imported.items[0].draft.choices).toHaveLength(2);
      expect(imported.items[0].draft.bodyHtml).toContain('Which city is in France?');
      expectImportedScore(imported, { RESPONSE: 'A' }, 100);
      expectImportedScore(imported, { RESPONSE: 'B' }, 0);
    }
    for (
      const analysis of [
        await analyzeImport(qti12Adapter, direct, source),
        await analyzeImport(imsccAdapter, cartridge, cartridgeSource),
      ]
    ) {
      expect(analysis.items[0].readiness).toBe('blocked');
      const warning = analysis.items[0].warnings.find((w) =>
        w.code === 'CANVAS_BANK_POINTS_UNASSIGNED'
      );
      expect(warning?.message).toContain('100 is not an assigned point ceiling');
      expect(warning?.message).toContain('Assign points');
    }
  }
});
test('missing quiz points, invalid bank points and unsupported bank scoring remain blocked', async () => {
  for (
    const xml of [
      canvasChoiceXml(''),
      bankXml('invalid'),
      bankXml('-2'),
      bankXml().replace('>100</setvar>', '>50</setvar>'),
    ]
  ) {
    const source = { filename: 'invalid.xml', bytes: encode(xml) };
    const imported = await qti12Adapter.parse(source);
    expect((await analyzeImport(qti12Adapter, imported, source)).items[0].readiness).toBe(
      'blocked',
    );
    expect(imported.items[0].draft.type).toBe('extended_text');
  }
  const source = { filename: 'assigned.xml', bytes: encode(bankXml('4')) };
  const assigned = await qti12Adapter.parse(source);
  expect((await analyzeImport(qti12Adapter, assigned, source)).items[0].readiness).toBe('ready');
  expectImportedScore(assigned, { RESPONSE: 'A' }, 4);
});
test('unassigned bank points cannot be approved as a 100-point question', async () => {
  await withBankReviewSource(
    { filename: 'bank.xml', mime: 'application/xml', bytes: encode(bankXml()) },
    'qti12',
    async (ctx, runId) => {
      const page = await getMigrationReviewPage(ctx, runId, 1, false);
      if (!page?.run.items[0]) {
        expect.unreachable('Expected bank review question');
      }
      const item = page.run.items[0];
      expect(item.itemType).toBe('single_select');
      expect(item.readiness).toBe('blocked');
      await expect(
        updateMigrationItems(
          ctx,
          runId,
          [item.id],
          { kind: 'accept' },
          {
            [item.id]: {
              contentHash: item.contentHash,
              contextHash: item.contextHash,
              decision: item.decision,
            },
          },
        ),
      ).rejects.toThrow('Blocked items must be corrected');
      const after = await getMigrationReviewPage(ctx, runId, 1, false);
      expect(after?.run.items[0].acceptedSnapshot).toBe(null);
    },
  );
});
