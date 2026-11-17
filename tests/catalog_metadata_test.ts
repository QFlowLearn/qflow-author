import { expect, test as testCase } from 'vitest';

import { parseQtiXml } from '@longsightgroup/qti3-core';
import {
  buildCatalogInfoXml,
  buildStylesheetXml,
  CatalogMetadataValidationError,
  catalogsFromQtiItem,
  injectItemMetadataIntoXml,
  makeCatalogSupport,
  stylesheetsFromQtiItem,
  UnsupportedCatalogContentError,
  validateCatalogMetadata,
} from '../lib/catalog_metadata.ts';
import type { CatalogDraft, StylesheetDraft } from '../lib/types/draft.ts';

const BASE_ITEM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="item-1" title="Item">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>
  <qti-item-body><p><span data-catalog-idref="term-1">Term</span></p></qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>
</qti-assessment-item>`;

const MULTILINGUAL_CATALOGS: CatalogDraft[] = [{
  id: 'term-1',
  attributes: { id: 'term-1', 'data-owner': 'author' },
  cards: [
    {
      support: { kind: 'predefined', value: 'glossary-on-screen' },
      language: 'en',
      contentHtml: '<p><strong>Term:</strong> a defined concept.</p>',
      attributes: { support: 'glossary-on-screen', 'xml:lang': 'en', 'data-card': 'glossary' },
    },
    {
      support: { kind: 'predefined', value: 'keyword-translation' },
      entries: [
        {
          language: 'es',
          default: true,
          contentHtml: '<p>término</p>',
          files: [{ href: '/uploads/term-es-audio', mimeType: 'audio/mpeg' }],
          attributes: { 'xml:lang': 'es', default: 'true', 'data-entry': 'primary' },
        },
        { language: 'fr-CA', contentHtml: '<p>terme</p>' },
      ],
    },
    {
      support: { kind: 'predefined', value: 'spoken' },
      files: [{
        href: '/uploads/term-audio',
        mimeType: 'audio/ogg',
        attributes: { 'mime-type': 'audio/ogg' },
      }],
    },
  ],
}];

const STYLESHEETS: StylesheetDraft[] = [{
  href: '/uploads/item-css',
  type: 'text/css',
  media: 'screen',
  title: 'Item theme',
  attributes: {
    href: '/uploads/item-css',
    type: 'text/css',
    media: 'screen',
    title: 'Item theme',
    'data-theme': 'contrast',
  },
}];

testCase('catalog support constructor classifies predefined values after normalization', () => {
  expect(makeCatalogSupport(' glossary-on-screen ')).toStrictEqual({
    kind: 'predefined',
    value: 'glossary-on-screen',
  });
});

testCase(
  'catalog metadata emits hierarchical multilingual glossary, translations, files, and attributes',
  () => {
    const xml = buildCatalogInfoXml(MULTILINGUAL_CATALOGS);
    expect(xml).toContain('<qti-catalog');
    expect(xml).toContain('id="term-1"');
    expect(xml).toContain('data-owner="author"');
    expect(xml).toContain('support="glossary-on-screen"');
    expect(xml).toContain('xml:lang="en"');
    expect(xml).toContain('data-card="glossary"');
    expect(xml).toContain('<qti-card support="keyword-translation">');
    expect(xml).toContain('xml:lang="es"');
    expect(xml).toContain('default="true"');
    expect(xml).toContain('data-entry="primary"');
    expect(xml).toContain('<source src="/uploads/term-es-audio" type="audio/mpeg"/>');
    expect(xml).toContain('<strong>Term:</strong>');
  },
);

testCase('catalog XML sanitizes HTML at the publication boundary', () => {
  const xml = buildCatalogInfoXml([{
    id: 'term-1',
    cards: [{
      support: { kind: 'predefined', value: 'glossary-on-screen' },
      contentHtml:
        '<p style="color:red" onclick="alert(1)">Definition<script>alert(2)</script><img src="javascript:alert(3)" alt="term"></p>',
    }],
  }]);

  expect(xml).toContain('<p>Definition');
  expect(xml).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  expect(xml).toContain('<img alt="term"/>');
  if (!((xml.includes('onclick=')) === false)) {
    expect.unreachable("Expected xml.includes('onclick=') to be false");
  }
  if (!((xml.includes('style=')) === false)) {
    expect.unreachable("Expected xml.includes('style=') to be false");
  }
  if (!((xml.includes('javascript:')) === false)) {
    expect.unreachable("Expected xml.includes('javascript:') to be false");
  }
});

testCase('catalog import and republication preserves structured catalog data', () => {
  const xml = injectItemMetadataIntoXml(BASE_ITEM_XML, MULTILINGUAL_CATALOGS, STYLESHEETS);
  const parsed = parseQtiXml(xml);
  if (!(parsed.document)) expect.unreachable('Expected parsed.document');
  const imported = catalogsFromQtiItem(parsed.document.item);
  const stylesheets = stylesheetsFromQtiItem(parsed.document.item);

  expect(imported.length).toStrictEqual(1);
  expect(imported[0].id).toStrictEqual('term-1');
  expect(imported[0].attributes?.['data-owner']).toStrictEqual('author');
  expect(imported[0].cards.length).toStrictEqual(3);
  expect(imported[0].cards[1].entries?.map((entry) => entry.language)).toStrictEqual([
    'es',
    'fr-CA',
  ]);
  expect(imported[0].cards[1].entries?.[0].default).toStrictEqual(true);
  expect(imported[0].cards[1].entries?.[0].files?.[0].href ?? '').toContain(
    '/uploads/term-es-audio',
  );
  expect(imported[0].cards[1].entries?.[0].contentHtml).toStrictEqual('<p>término</p>');
  expect(imported[0].cards[0].contentHtml ?? '').toContain('<strong>Term:</strong>');
  expect(stylesheets[0].href).toStrictEqual('/uploads/item-css');
  expect(stylesheets[0].media).toStrictEqual('screen');
  expect(stylesheets[0].attributes?.['data-theme']).toStrictEqual('contrast');

  const republished = injectItemMetadataIntoXml(BASE_ITEM_XML, imported, stylesheets);
  const parsedRepublished = parseQtiXml(republished);
  if (!(parsedRepublished.document)) expect.unreachable('Expected parsedRepublished.document');
  const roundTripped = catalogsFromQtiItem(parsedRepublished.document.item);
  expect(roundTripped).toStrictEqual(imported);
  expect(stylesheetsFromQtiItem(parsedRepublished.document.item)).toStrictEqual(stylesheets);
});

testCase('catalog import rejects QTI interactions inside HTML content', () => {
  const xml = BASE_ITEM_XML.replace(
    /(<qti-response-processing\b)/,
    `<qti-catalog-info>
      <qti-catalog id="term-1">
        <qti-card support="glossary-on-screen">
          <qti-card-entry>
            <qti-html-content>
              <qti-choice-interaction response-identifier="RESPONSE"/>
            </qti-html-content>
          </qti-card-entry>
        </qti-card>
      </qti-catalog>
    </qti-catalog-info>
    $1`,
  );

  const parsed = parseQtiXml(xml);
  const document = parsed.document;
  if (!document) expect.unreachable('Expected document');

  expect(() => catalogsFromQtiItem(document.item)).toThrowError(
    expect.toSatisfy((caught: unknown) =>
      caught instanceof UnsupportedCatalogContentError &&
      caught.message.includes('qti-choice-interaction')
    ),
  );
});

testCase('stylesheet XML preserves declarations and extension attributes', () => {
  const xml = buildStylesheetXml(STYLESHEETS);
  expect(xml).toContain('href="/uploads/item-css"');
  expect(xml).toContain('type="text/css"');
  expect(xml).toContain('media="screen"');
  expect(xml).toContain('title="Item theme"');
  expect(xml).toContain('data-theme="contrast"');
});

testCase(
  'catalog validation rejects invalid languages, duplicate defaults, duplicate supports, and implicit custom supports',
  () => {
    const issues = validateCatalogMetadata([{
      id: 'term-1',
      cards: [
        {
          support: { kind: 'predefined', value: 'keyword-translation' },
          entries: [
            { language: 'not_a_language', default: true, contentHtml: '<p>A</p>' },
            { default: true, contentHtml: '<p>B</p>' },
          ],
        },
        {
          support: { kind: 'predefined', value: 'keyword-translation' },
          entries: [{ language: 'de', contentHtml: '<p>C</p>' }],
        },
        {
          support: { kind: 'predefined', value: 'vendor-support' },
          entries: [{ contentHtml: '<p>D</p>' }],
        },
      ],
    }]);

    expect(issues.some((issue) => issue.code === 'LANGUAGE_TAG_INVALID')).toStrictEqual(true);
    expect(issues.some((issue) => issue.code === 'KEYWORD_TRANSLATION_LANGUAGE_REQUIRED'))
      .toStrictEqual(true);
    expect(issues.some((issue) => issue.code === 'CATALOG_DEFAULT_CONFLICT')).toStrictEqual(true);
    expect(issues.some((issue) => issue.code === 'CATALOG_SUPPORT_DUPLICATE')).toStrictEqual(true);
    expect(issues.some((issue) => issue.code === 'CATALOG_SUPPORT_INVALID')).toStrictEqual(true);
  },
);

testCase('publication blocks unsafe stylesheet and catalog file references', () => {
  expect(() =>
    injectItemMetadataIntoXml(
      BASE_ITEM_XML,
      [{
        id: 'term-1',
        cards: [{
          support: { kind: 'predefined', value: 'glossary-on-screen' },
          files: [{ href: '../outside.html', mimeType: 'text/html' }],
        }],
      }],
      [{ href: 'https://example.com/item.css', type: 'text/css' }],
    )
  ).toThrowError(CatalogMetadataValidationError);
});
