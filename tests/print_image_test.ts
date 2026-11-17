import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { preparePrintImage } from '../lib/print/print_image.ts';

async function fixture(name: string) {
  return new Uint8Array(await readFile(new URL(`./fixtures/print/${name}`, import.meta.url)));
}

test('static PNG preserves dimensions and transparency while stripping free-form staff metadata', async () => {
  const original = await fixture('metadata-alpha.png');
  const result = preparePrintImage(original);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value).toMatchObject({ width: 3, height: 2, mediaType: 'image/png' });
  expect(new TextDecoder().decode(original)).toContain('STAFF_PNG_METADATA');
  expect(new TextDecoder().decode(result.value.bytes)).not.toContain('STAFF_PNG_METADATA');
  expect(preparePrintImage(result.value.bytes)).toEqual(result);
});

test('JPEG static RGB is supported; orientation and color transforms require author repair', async () => {
  const result = preparePrintImage(await fixture('normal.jpg'));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toMatchObject({ width: 3, height: 2, mediaType: 'image/jpeg' });
  }
  expect(preparePrintImage(await fixture('orientation.jpg'))).toEqual({
    ok: false,
    code: 'image_orientation',
  });
  expect(preparePrintImage(await fixture('cmyk.jpg'))).toEqual({ ok: false, code: 'image_color' });
  expect(preparePrintImage(new Uint8Array([255, 216, 255, 217]))).toEqual({
    ok: false,
    code: 'image_invalid',
  });
});

test('animated PNG is a blocker, never a silently selected first frame', async () => {
  expect(preparePrintImage(await fixture('animated.png'))).toEqual({
    ok: false,
    code: 'image_animation',
  });
});

test('known ancillary names cannot carry arbitrary private metadata and unknown JPEG markers block', async () => {
  expect(preparePrintImage(await fixture('invalid-gamma.png'))).toEqual({
    ok: false,
    code: 'image_invalid',
  });
  expect(preparePrintImage(await fixture('unknown-marker.jpg'))).toEqual({
    ok: false,
    code: 'image_invalid',
  });
});
