import { expect, test as testCase } from 'vitest';

import { inferImageMimeFromSource } from '../lib/types/image_source.ts';
import { hasImageMimeType, resolveImageMimeType } from '../lib/types/image_asset.ts';

testCase('image MIME inference supports data URLs', () => {
  expect(inferImageMimeFromSource('data:image/svg+xml;base64,PHN2Zy8+')).toStrictEqual(
    'image/svg+xml',
  );
  expect(inferImageMimeFromSource('data:image/png;charset=utf-8,encoded')).toStrictEqual(
    'image/png',
  );
});

testCase('image MIME inference supports filenames with URL suffixes', () => {
  expect(inferImageMimeFromSource('/images/canvas.svg?revision=2')).toStrictEqual('image/svg+xml');
  expect(inferImageMimeFromSource('https://example.com/photo.JPG#preview')).toStrictEqual(
    'image/jpeg',
  );
  expect(inferImageMimeFromSource('/uploads/image-without-extension')).toStrictEqual(undefined);
});

testCase('image MIME resolution never invents a fallback', () => {
  expect(resolveImageMimeType({ source: '/uploads/image-without-extension', mimeType: '' }))
    .toStrictEqual(undefined);
  expect(resolveImageMimeType({
    source: '/uploads/image-without-extension',
    mimeType: ' image/webp ',
  })).toStrictEqual('image/webp');
  expect(hasImageMimeType({ source: '/uploads/image-without-extension', mimeType: '' }))
    .toStrictEqual(false);
});
