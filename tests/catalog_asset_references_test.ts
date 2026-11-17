import { expect, test as testCase } from 'vitest';

import {
  collectCatalogMetadataAssetPaths,
  rewriteCatalogMetadataAssetReferences,
} from '../lib/import/catalog_asset_references.ts';
import {
  collectImportedAssetReferenceKeys,
  rewriteImportedAssetReferences,
} from '../lib/import/imported_asset_references.ts';
import {
  collectReferencedPackageAssetKeys,
  rewriteImportedDraft,
} from '../lib/import/package_asset_references.ts';
import type { ImportResult } from '../lib/import/types.ts';
import type { Draft } from '../lib/types/draft.ts';
import { parseItemLanguage } from '../lib/types/item_language.ts';

const IMPORTED_LANGUAGE = parseItemLanguage('fr-CA');

const draft: Draft = {
  type: 'single_select',
  itemLanguage: IMPORTED_LANGUAGE,
  stylesheets: [{ href: '../assets/item.css', type: 'text/css' }],
  catalogs: [{
    id: 'term',
    cards: [{
      support: { kind: 'predefined', value: 'long-description' },
      files: [{ href: '../assets/description.html', mimeType: 'text/html' }],
      entries: [{ files: [{ href: '../assets/audio.mp3', mimeType: 'audio/mpeg' }] }],
    }],
  }],
};

testCase('catalog metadata asset paths resolve relative to the imported item', () => {
  expect(collectCatalogMetadataAssetPaths(draft, 'items/item.xml')).toStrictEqual([
    'assets/item.css',
    'assets/description.html',
    'assets/audio.mp3',
  ]);
});

testCase('catalog metadata asset references are rewritten in the canonical draft', () => {
  const rewritten = rewriteCatalogMetadataAssetReferences(
    draft,
    'items/item.xml',
    (packagePath) => `/uploads/${packagePath.replaceAll('/', '-')}`,
  );

  expect(rewritten.stylesheets?.[0].href).toStrictEqual('/uploads/assets-item.css');
  expect(rewritten.catalogs?.[0].cards[0].files?.[0].href).toStrictEqual(
    '/uploads/assets-description.html',
  );
  expect(rewritten.catalogs?.[0].cards[0].entries?.[0].files?.[0].href).toStrictEqual(
    '/uploads/assets-audio.mp3',
  );
});

testCase('generic item references resolve from the item directory', () => {
  const xml = `
    <qti-assessment-item>
      <img src="../assets/prompt.png">
      <qti-file-href>../catalogs/support.xml</qti-file-href>
    </qti-assessment-item>`;

  expect([...collectImportedAssetReferenceKeys(xml, 'items/item.xml')]).toStrictEqual([
    'assets/prompt.png',
    'catalogs/support.xml',
  ]);
});

testCase('generic item references rewrite to stored upload URLs', () => {
  const xml =
    '<img src="../assets/prompt.png"><qti-file-href>../catalogs/support.xml</qti-file-href>';
  const uploads = new Map([
    ['assets/prompt.png', { url: '/uploads/prompt' }],
    ['catalogs/support.xml', { url: '/uploads/support' }],
  ]);

  expect(rewriteImportedAssetReferences(xml, uploads, 'items/item.xml')).toStrictEqual(
    '<img src="/uploads/prompt"><qti-file-href>/uploads/support</qti-file-href>',
  );
});

testCase('rewriteImportedDraft rewrites package assets embedded in catalog HTML', () => {
  const draft: Draft = {
    type: 'single_select',
    itemLanguage: IMPORTED_LANGUAGE,
    catalogs: [{
      id: 'term',
      cards: [{
        support: { kind: 'predefined', value: 'long-description' },
        entries: [{
          contentHtml: '<p><img src="../assets/illustration.png" alt="diagram"></p>',
        }],
      }],
    }],
  };
  const uploads = new Map([['assets/illustration.png', { url: '/uploads/illustration' }]]);

  const rewritten = rewriteImportedDraft(draft, 'items/item.xml', uploads);

  expect(rewritten.itemLanguage).toStrictEqual(IMPORTED_LANGUAGE);
  expect(rewritten.catalogs?.[0].cards[0].entries?.[0].contentHtml).toStrictEqual(
    '<p><img src="/uploads/illustration" alt="diagram"></p>',
  );
});

testCase('collectReferencedPackageAssetKeys fails fast for missing package assets', () => {
  const parsed: ImportResult = {
    organizationGroups: [],
    title: 'Test',
    parts: [],
    items: [{
      href: 'items/item.xml',
      identifier: 'item',
      title: 'Item',
      xml: '<img src="../assets/missing.png">',
      draft: {
        type: 'single_select',
        itemLanguage: IMPORTED_LANGUAGE,
        stylesheets: [{ href: '../assets/missing.css', type: 'text/css' }],
      },
    }],
    assets: [],
  };

  expect(() => collectReferencedPackageAssetKeys(parsed, new Map())).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof Error &&
      caught.message.includes(
        'Package asset assets/missing.png is referenced but missing from the package.',
      )
    ),
  );
});
