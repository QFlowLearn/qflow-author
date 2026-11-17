import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { blackboardAdapter } from '../lib/import/adapters/blackboard.ts';
import { writeZip } from '../lib/zip.ts';
import { blackboardPool, importBlackboardPool } from './helpers/blackboard_import.ts';
import { analyzeImport, expectImportedScore } from './helpers/lms_import.ts';
import { collectImportedAssetReferenceKeys } from '../lib/import/imported_asset_references.ts';
test('Blackboard HTML and images retain content and original package-relative resolution', async () => {
  const png = new Uint8Array(
    await readFile(new URL('./fixtures/import/qti21/hotspot_package/map.png', import.meta.url)),
  );
  const xml = blackboardPool({
    html: true,
    body: '<p>Choose <strong>bold</strong>. <img src="images/map%20image.png" alt="Map"/></p>',
    answers:
      '<ANSWER id="a" position="1"><TEXT><![CDATA[<em>Yes</em>]]></TEXT><FLAGS><ISHTML value="true"/></FLAGS></ANSWER><ANSWER id="b" position="2"><TEXT>No</TEXT></ANSWER>',
  });
  const source = {
    filename: 'blackboard.zip',
    bytes: await writeZip([
      { name: 'pools/questions.dat', data: new TextEncoder().encode(xml) },
      { name: 'pools/images/map image.png', data: png },
    ]),
  };
  const imported = await blackboardAdapter.parse(source);
  expect(imported.items[0].draft.bodyHtml).toContain('<strong>bold</strong>');
  expect(imported.items[0].draft.choices?.[0].html).toContain('<em>Yes</em>');
  expect([...collectImportedAssetReferenceKeys(imported.items[0].draft, imported.items[0].href)])
    .toContain('pools/images/map image.png');
  expect(imported.assets[0].data).toEqual(png);
  expect((await analyzeImport(blackboardAdapter, imported, source)).items[0].readiness).toBe(
    'ready',
  );
  expectImportedScore(imported, { RESPONSE: 'A' }, 1);
});
test('Blackboard plain text stays literal and missing media requires correction', async () => {
  const plain = await importBlackboardPool(blackboardPool({ body: '<strong>Literal</strong>' }));
  expect(plain.imported.items[0].draft.bodyHtml).toContain('&lt;strong&gt;');
  const missing = await importBlackboardPool(
    blackboardPool({ html: true, body: 'Prompt <img src="missing.png"/>' }),
  );
  expect(missing.analysis.items[0].readiness).toBe('blocked');
  expect(missing.analysis.items[0].warnings[0].code).toBe('LMS_MEDIA_REVIEW');
});
