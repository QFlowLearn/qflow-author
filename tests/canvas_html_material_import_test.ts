import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { qti12Adapter } from '../lib/import/adapters/qti12.ts';
import { imsccAdapter } from '../lib/import/adapters/imscc.ts';
import { canvasChoiceXml } from './helpers/canvas_import.ts';
import { canvasCartridge } from './helpers/canvas_cartridge.ts';
import { analyzeImport, expectImportedScore } from './helpers/lms_import.ts';
test('Canvas HTML void elements and named entities normalize without changing question scoring', async () => {
  for (const html of ['<div>Line<br>two.</div>', '<p>A&nbsp;B &copy; C.</p>']) {
    const xml = canvasChoiceXml().replace('Which city is in France?', `<![CDATA[${html}]]>`);
    const source = { filename: 'canvas.xml', bytes: new TextEncoder().encode(xml) };
    const direct = await qti12Adapter.parse(source);
    expect((await analyzeImport(qti12Adapter, direct, source)).items[0].readiness).toBe('ready');
    expectImportedScore(direct, { RESPONSE: 'A' }, 3);
    const cartridge = {
      filename: 'canvas.imscc',
      bytes: await canvasCartridge({ ccXml: '<questestinterop/>', nativeXml: xml }),
    };
    const imported = await imsccAdapter.parse(cartridge);
    expect(imported.items[0].draft.type).toBe('single_select');
    expectImportedScore(imported, { RESPONSE: 'A' }, 3);
  }
});
test('Canvas unclosed HTML img elements keep the declared image bytes', async () => {
  const png = new Uint8Array(
    await readFile(new URL('./fixtures/import/qti21/hotspot_package/map.png', import.meta.url)),
  );
  const nativeXml = canvasChoiceXml().replace(
    'Which city is in France?',
    '<![CDATA[<p>Map <img src="$IMS-CC-FILEBASE$/map.png" alt="Map"></p>]]>',
  );
  const source = {
    filename: 'canvas.imscc',
    bytes: await canvasCartridge({
      ccXml: '<questestinterop/>',
      nativeXml,
      extraResources:
        '<resource identifier="MEDIA" type="webcontent" href="web_resources/map.png"><file href="web_resources/map.png"/></resource>',
      extraFiles: [{ name: 'web_resources/map.png', data: png }],
    }),
  };
  const imported = await imsccAdapter.parse(source);
  expect(imported.items[0].draft.bodyHtml).toContain('<img ');
  expect(imported.assets[0].data).toEqual(png);
  expect((await analyzeImport(imsccAdapter, imported, source)).items[0].readiness).not.toBe(
    'blocked',
  );
});
