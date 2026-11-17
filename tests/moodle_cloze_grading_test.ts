import { expect, test } from 'vitest';
import { importMoodleQuestion } from './helpers/moodle_second_pass.ts';
import { expectImportedScore } from './helpers/lms_import.ts';
import { parseItemXml } from '../lib/import/adapters/qti3/parse_item.ts';
import { buildQtiPreviewXml } from '../lib/qti_preview.ts';
import { scoreQtiItemServerSide } from '@longsightgroup/qti3-core';
test('Moodle Cloze blank weights retain the source total and independent credit', async () => {
  for (const kind of ['SHORTANSWER', 'MULTICHOICE']) {
    const { imported, analysis } = await importMoodleQuestion(
      'cloze',
      `<p>{2:${kind}:=cat~other} {1:${kind}:=dog~other}</p>`,
    );
    expect(analysis.items[0].readiness).toBe('ready');
    const first = kind === 'SHORTANSWER' ? 'cat' : 'A';
    const second = kind === 'SHORTANSWER' ? 'dog' : 'A';
    const wrong = kind === 'SHORTANSWER' ? 'wrong' : 'B';
    expectImportedScore(imported, { RESPONSE_1: first, RESPONSE_2: second }, 3);
    expectImportedScore(imported, { RESPONSE_1: first, RESPONSE_2: wrong }, 2);
    expectImportedScore(imported, { RESPONSE_1: wrong, RESPONSE_2: second }, 1);
    const reopened = parseItemXml(imported.items[0].xml);
    const preview = buildQtiPreviewXml(reopened.draft);
    if (!preview.ok) expect.unreachable('Expected faithful authoring reimport');
    expect(
      scoreQtiItemServerSide({
        itemXml: preview.xml,
        trustedResponses: { RESPONSE_1: first, RESPONSE_2: second },
      }).score,
    ).toBe(3);
  }
});
test('Moodle Cloze header marks cannot multiply the entire score per blank', async () => {
  for (const header of ['<defaultgrade>3</defaultgrade>', '<defaultgrade>9</defaultgrade>']) {
    const { imported, analysis } = await importMoodleQuestion(
      'cloze',
      '<p>{2:SA:=cat} {1:SA:=dog}</p>',
      header,
    );
    expectImportedScore(imported, { RESPONSE_1: 'cat', RESPONSE_2: 'dog' }, 3);
    expect(analysis.items[0].readiness).toBe(header.includes('>3<') ? 'ready' : 'blocked');
  }
});
