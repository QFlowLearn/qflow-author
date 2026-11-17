import { expect, test } from 'vitest';
import { qti12Adapter } from '../lib/import/adapters/qti12.ts';
import { imsccAdapter } from '../lib/import/adapters/imscc.ts';
import { canvasChoiceXml } from './helpers/canvas_import.ts';
import { canvasCartridge } from './helpers/canvas_cartridge.ts';
import { expectImportedScore } from './helpers/lms_import.ts';
test('Canvas answer material stays out of the stem while nested presentation flow keeps its stimulus', async () => {
  for (
    const xml of [
      canvasChoiceXml(),
      canvasChoiceXml().replace('<presentation>', '<presentation><flow>').replace(
        '</presentation>',
        '</flow></presentation>',
      ),
    ]
  ) {
    const direct = await qti12Adapter.parse({
      filename: 'canvas.xml',
      bytes: new TextEncoder().encode(xml),
    });
    const cartridge = await imsccAdapter.parse({
      filename: 'canvas.imscc',
      bytes: await canvasCartridge({ ccXml: '<questestinterop/>', nativeXml: xml }),
    });
    for (const imported of [direct, cartridge]) {
      const draft = imported.items[0].draft;
      expect(draft.bodyHtml).toContain('Which city is in France?');
      expect(draft.bodyHtml).not.toContain('Paris');
      expect(draft.bodyHtml).not.toContain('Berlin');
      expect(draft.choices?.map((choice) => choice.text)).toEqual(['Paris', 'Berlin']);
      expectImportedScore(imported, { RESPONSE: 'A' }, 3);
    }
  }
});
