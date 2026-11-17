import { expect, test as testCase } from 'vitest';

import { ASSET_ATTR_REGEX, packageAssetKey, resolvePackageAssetPath } from '../lib/asset_refs.ts';

testCase('ASSET_ATTR_REGEX matches src/href and object data (but not data-*)', () => {
  const html = `<qti-object DATA="assets/diagram.png" type="image/png"></qti-object>` +
    `<qti-img src="assets/a.png" alt="a"/>` +
    `<a href="assets/b.png">b</a>` +
    `<div data-foo="nope"></div>`;

  const matches = Array.from(html.matchAll(ASSET_ATTR_REGEX)).map((m) => ({
    attr: m[1],
    value: m[3],
  }));

  expect(matches).toStrictEqual([
    { attr: 'DATA', value: 'assets/diagram.png' },
    { attr: 'src', value: 'assets/a.png' },
    { attr: 'href', value: 'assets/b.png' },
  ]);
});

testCase('package asset paths resolve relative to the item file', () => {
  expect(resolvePackageAssetPath('../assets/prompt.png', 'items/item.xml')).toStrictEqual(
    'assets/prompt.png',
  );
  expect(packageAssetKey('../assets/prompt.png', 'items/item.xml')).toStrictEqual(
    'assets/prompt.png',
  );
  expect(packageAssetKey('https://example.com/a.png', 'items/item.xml')).toStrictEqual(null);
});
