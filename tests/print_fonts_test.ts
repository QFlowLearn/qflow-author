import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { printDocumentFontsSupported, printFontCoverage } from '../lib/print/print_fonts.ts';

test('actual pinned fonts cover verified locales/math and reject unavailable glyphs before rendering', async () => {
  const fonts = await Promise.all(
    ['NewCM10-Regular', 'NewCM10-Bold', 'NewCM10-Italic', 'NewCMMath-Regular'].map(async (name) =>
      new Uint8Array(await readFile(new URL(`../vendor/typst/${name}.otf.bin`, import.meta.url)))
        .buffer
    ),
  );
  const supports = printFontCoverage(fonts);
  expect(supports('Ångström – Español; Ω α β ∑ √ ½\n')).toBe(true);
  expect(supports('🦄')).toBe(false);
  expect(printDocumentFontsSupported({ title: 'Ångström', parts: [{ text: '🦄' }] }, supports))
    .toBe(false);
  expect(
    printDocumentFontsSupported({ title: 'Ångström', images: [{ bytes: [255, 0, 1] }] }, supports),
  ).toBe(true);
});

test('recorded actual format4 and format12 tables independently resolve BMP and supplementary glyphs', async () => {
  const original = await readFile(
    new URL('../vendor/typst/NewCM10-Regular.otf.bin', import.meta.url),
  );
  // These offsets belong to the integrity-pinned font fixture: cmap=2424, records4/12=2428/2436.
  const format4 = Buffer.from(original),
    format12 = await readFile(
      new URL('../vendor/typst/NewCMMath-Regular.otf.bin', import.meta.url),
    );
  format4.writeUInt16BE(1, 2426);
  format12.copy(format12, 1772, 1780, 1788);
  format12.writeUInt16BE(1, 1770);
  const bmp = printFontCoverage([new Uint8Array(format4).buffer]),
    supplementary = printFontCoverage([new Uint8Array(format12).buffer]);
  expect(bmp('ÅΩ')).toBe(true);
  expect(bmp('𝑥')).toBe(false);
  expect(supplementary('Ω𝑥')).toBe(true);
  expect(supplementary('🦄')).toBe(false);
});

test('invalid actual-font directory and cmap bounds fail startup without a fallback font', async () => {
  const original = await readFile(
    new URL('../vendor/typst/NewCM10-Regular.otf.bin', import.meta.url),
  );
  const directory = Buffer.from(original);
  directory.writeUInt16BE(65535, 4);
  const offset = Buffer.from(original);
  offset.writeUInt32BE(0xffffffff, 2432);
  const length = Buffer.from(original);
  length.writeUInt16BE(1, 2426);
  const table = 2424 + length.readUInt32BE(2432);
  length.writeUInt16BE(8, table + 2);
  for (
    const bytes of [
      new Uint8Array(),
      new Uint8Array(directory),
      new Uint8Array(offset),
      new Uint8Array(length),
    ]
  ) expect(() => printFontCoverage([bytes.buffer])).toThrow();
});
