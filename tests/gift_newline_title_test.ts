import { expect, test } from 'vitest';
import { giftAdapter } from '../lib/import/adapters/gift.ts';
test('Moodle GIFT newlines and escaped title punctuation decode once', async () => {
  const source = String.raw`::Ratio a\:b\#c::[plain]First line\nSecond line {=yes ~no}`;
  const imported = await giftAdapter.parse({
    filename: 'moodle.gift',
    bytes: new TextEncoder().encode(source),
  });
  expect(imported.items[0].title).toBe('Ratio a:b#c');
  expect(imported.items[0].draft.bodyHtml).toBe('<p>First line<br/>Second line</p>');
});
test('GIFT escaped backslashes remain literal rather than becoming newline syntax', async () => {
  const source = String.raw`::Literal::[plain]Backslash \\n remains {=yes ~no}`;
  const imported = await giftAdapter.parse({
    filename: 'moodle.gift',
    bytes: new TextEncoder().encode(source),
  });
  expect(imported.items[0].draft.bodyHtml).toContain(String.raw`Backslash \n remains`);
  expect(imported.items[0].draft.bodyHtml).not.toContain('<br');
});
