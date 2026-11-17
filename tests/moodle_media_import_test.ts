import { readFile } from 'node:fs/promises';
import { writeQti3PackageFilesResult } from '@longsightgroup/qti3-writer';
import { parseQtiPackageEntries } from '../lib/import/adapters/qti3/parse_package.ts';
import { expect, test } from 'vitest';
import { importMoodle } from './helpers/lms_import.ts';
import { assetKey } from '../lib/asset_refs.ts';
import { collectImportedAssetReferenceKeys } from '../lib/import/imported_asset_references.ts';
const field = (data: string) =>
  `<text><![CDATA[Prompt <img src="@@PLUGINFILE@@/map%20image.png?download=1#map"/>]]></text><file name="map image.png" path="/" encoding="base64">${data}</file>`;
test('Moodle file areas retain distinct bytes for identical filenames and resolve encoded URLs', async () => {
  const bodyImage = new Uint8Array(
    await readFile(new URL('./fixtures/import/qti21/hotspot_package/map.png', import.meta.url)),
  );
  const answerImage = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  const { imported, analysis } = await importMoodle(
    `<question type="multichoice"><name><text>Media</text></name><questiontext format="html">${
      field(Buffer.from(bodyImage).toString('base64'))
    }</questiontext><single>true</single><answer format="html" fraction="100">${
      field(Buffer.from(answerImage).toString('base64'))
    }</answer><answer fraction="0"><text>Other</text></answer></question>`,
  );
  expect(analysis.items[0].readiness).toBe('ready');
  expect(new Set(imported.assets.map((asset) => asset.path)).size).toBe(2);
  expect(imported.assets.map((asset) => asset.data)).toEqual([bodyImage, answerImage]);
  const item = imported.items[0];
  const packageResult = writeQti3PackageFilesResult({
    identifier: 'MOODLE_MEDIA',
    title: 'Media',
    items: [{
      kind: 'xml',
      path: item.href,
      identifier: item.identifier,
      xml: item.xml,
      assets: imported.assets.map((asset) => ({ path: asset.path, data: asset.data })),
    }],
  });
  if (!packageResult.ok) expect.unreachable('Expected a valid media package');
  const reopened = await parseQtiPackageEntries(packageResult.files);
  expect(reopened.assets.map((asset) => asset.data)).toEqual([bodyImage, answerImage]);
  const draft = item.draft;
  expect(draft.bodyHtml).not.toContain('PLUGINFILE');
  expect(draft.choices?.[0].html).not.toContain('PLUGINFILE');
  expect(draft.bodyHtml).toContain('?download=1#map');
  expect([...collectImportedAssetReferenceKeys(draft, imported.items[0].href)].sort()).toEqual(
    imported.assets.map((asset) => assetKey(asset.path)).sort(),
  );
});
test('missing Moodle embedded files have blocking media findings', async () => {
  const { analysis } = await importMoodle(
    '<question type="essay"><name><text>Missing</text></name><questiontext format="html"><text><![CDATA[Prompt <img src="@@PLUGINFILE@@/missing.png"/>]]></text></questiontext></question>',
  );
  expect(analysis.items[0].readiness).toBe('blocked');
  expect(analysis.items[0].warnings[0].code).toBe('LMS_MEDIA_REVIEW');
});
