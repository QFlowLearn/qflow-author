import { expect, test as testCase } from 'vitest';

import { safeMediaUrl } from '../lib/client/safe_media_url.ts';

testCase('safe media URLs allow uploaded and explicit external sources', () => {
  expect(safeMediaUrl('/uploads/asset-id')).toStrictEqual('/uploads/asset-id');
  expect(safeMediaUrl('https://cdn.example.edu/clip.mp4')).toStrictEqual(
    'https://cdn.example.edu/clip.mp4',
  );
  expect(safeMediaUrl('data:image/png;base64,AA==')).toStrictEqual('data:image/png;base64,AA==');
});

testCase('safe media URLs reject unsafe and package-relative navigation', () => {
  expect(safeMediaUrl('media.mp4')).toStrictEqual(null);
  expect(safeMediaUrl('assets/media.mp4')).toStrictEqual(null);
  expect(safeMediaUrl('//cdn.example.edu/clip.mp4')).toStrictEqual(null);
  expect(safeMediaUrl('javascript:alert(1)')).toStrictEqual(null);
});
