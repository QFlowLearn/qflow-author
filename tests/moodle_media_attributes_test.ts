import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { importMoodleQuestion, twoChoices } from './helpers/moodle_second_pass.ts';
test('Moodle field media resolves valid HTML attribute syntax before review', async () => {
  const png = await readFile(
    new URL('./fixtures/import/qti21/hotspot_package/map.png', import.meta.url),
  );
  const file = `<file name="map.png" path="/" encoding="base64">${png.toString('base64')}</file>`;
  for (
    const attribute of [
      'src = "@@PLUGINFILE@@/map.png"',
      'src=@@PLUGINFILE@@/map.png',
      "SRC = '@@PLUGINFILE@@/map.png'",
    ]
  ) {
    const { imported, analysis } = await importMoodleQuestion(
      'multichoice',
      `<p><img ${attribute} alt="Map"></p>`,
      twoChoices,
      'html',
      file,
    );
    expect(analysis.items[0].readiness).toBe('ready');
    expect(imported.items[0].xml).not.toContain('@@PLUGINFILE@@');
    expect(imported.items[0].draft.bodyHtml).toContain('moodle/Question/field-1/map.png');
    expect(imported.assets[0].data).toEqual(new Uint8Array(png));
  }
});
test('unresolved normalized Moodle media stays blocked', async () => {
  const { analysis } = await importMoodleQuestion(
    'multichoice',
    '<p><img src = "@@PLUGINFILE@@/missing.png" alt="Map"></p>',
    twoChoices,
  );
  expect(analysis.items[0].readiness).toBe('blocked');
  expect(analysis.items[0].warnings.map((w) => w.code)).toContain('LMS_MEDIA_REVIEW');
});
