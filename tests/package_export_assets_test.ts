import { expect, test as testCase } from 'vitest';

import { exportQti3TestItemXml } from './qti3_writer_test_helpers.ts';

import { buildAssessmentTestXml, type Part } from '../lib/test_export.ts';
import { defaultsGraphicGapMatch } from '../lib/types/graphic_gap_match.ts';
import { defaultsHotspot } from '../lib/types/hotspot.ts';
import { buildPackageManifestXml, collectPackageAssets } from '../lib/package_export.ts';
import {
  parseQtiPackage,
  parseQtiPackageEntries,
} from '../lib/import/adapters/qti3/parse_package.ts';
import { writeZip } from '../lib/zip.ts';
import { injectItemMetadataIntoXml } from '../lib/catalog_metadata.ts';
import { defaultsSingleSelect } from '../lib/types/single_select.ts';

testCase('package export bundles assets, rewrites refs, and aligns manifest', async () => {
  const hotspotDraft = defaultsHotspot();
  hotspotDraft.hotspotImageSrc = '/uploads/hotspot-img';
  hotspotDraft.hotspotImageAlt = 'Hotspot image';
  hotspotDraft.hotspotImageType = 'image/png';
  const hotspotXml = exportQti3TestItemXml('hotspot', hotspotDraft, { identifier: 'item-hotspot' });

  const ggmDraft = defaultsGraphicGapMatch();
  ggmDraft.graphicBackgroundSrc = '/uploads/ggm-bg';
  ggmDraft.graphicBackgroundType = 'image/png';
  ggmDraft.choices = ggmDraft.choices.map((choice, idx) => ({
    ...choice,
    kind: 'image',
    imgSrc: idx === 0 ? '/uploads/ggm-choice-a' : '/uploads/ggm-choice-b',
    imgType: 'image/png',
  }));
  const ggmXml = exportQti3TestItemXml('graphic_gap_match', ggmDraft, {
    identifier: 'item-graphic-gap',
  });

  const itemsXml: Record<string, string> = {
    'item-hotspot': hotspotXml,
    'item-graphic-gap': ggmXml,
  };

  const uploadMeta = new Map<string, { id: string; name: string; type?: string }>([
    ['hotspot-img', { id: 'hotspot-img', name: 'hotspot.png', type: 'image/png' }],
    ['ggm-bg', { id: 'ggm-bg', name: 'background.png', type: 'image/png' }],
    ['ggm-choice-a', { id: 'ggm-choice-a', name: 'choice-a.png', type: 'image/png' }],
    ['ggm-choice-b', { id: 'ggm-choice-b', name: 'choice-b.png', type: 'image/png' }],
  ]);
  const uploadData = new Map<string, Uint8Array>([
    ['hotspot-img', new Uint8Array([1])],
    ['ggm-bg', new Uint8Array([2])],
    ['ggm-choice-a', new Uint8Array([3])],
    ['ggm-choice-b', new Uint8Array([4])],
  ]);

  const getUploadId = (value: string) => {
    const match = value.match(/\/uploads\/([a-z0-9\-]+)/i);
    return match ? match[1] : null;
  };
  const getUpload = (id: string) => Promise.resolve(uploadMeta.get(id) ?? null);
  const readUploadFile = (upload: { id: string }) => {
    const data = uploadData.get(upload.id);
    if (!data) throw new Error(`Missing upload data for ${upload.id}`);
    return Promise.resolve(data);
  };

  const collected = await collectPackageAssets({ _tag: 'Items', itemsXml }, {
    getUploadId,
    getUpload,
    readUploadFile,
  });

  if (!(collected.ok)) expect.unreachable('Expected collected.ok');
  const { assets, rewrittenXml, assetIdsByItem } = collected.value;
  expect(assets.length).toStrictEqual(uploadMeta.size);
  for (const xml of Object.values(rewrittenXml)) {
    if (xml.includes('/uploads/')) expect.unreachable("Expected !xml.includes('/uploads/')");
    expect(xml).toContain('assets/');
  }

  const parts: Part[] = [
    {
      id: 'part-1',
      title: 'Part',
      placements: [
        { id: 'pl-1', itemId: 'item-hotspot' },
        { id: 'pl-2', itemId: 'item-graphic-gap' },
      ],
    },
  ];
  const manifestXml = buildPackageManifestXml('assessment-1', parts, assets, assetIdsByItem);

  for (const asset of assets) {
    expect(manifestXml).toContain(`href="assets/${asset.name}"`);
  }
  for (const assetId of assets.map((_, idx) => `asset-${idx + 1}`)) {
    expect(manifestXml).toContain(`dependency identifierref="${assetId}"`);
  }

  const testXml = buildAssessmentTestXml({ id: 'assessment-1', title: 'Assessment' }, parts);
  const zipBytes = await writeZip([
    { name: 'imsmanifest.xml', data: new TextEncoder().encode(manifestXml) },
    { name: 'assessment.xml', data: new TextEncoder().encode(testXml) },
    {
      name: 'items/item-hotspot.xml',
      data: new TextEncoder().encode(rewrittenXml['item-hotspot']),
    },
    {
      name: 'items/item-graphic-gap.xml',
      data: new TextEncoder().encode(rewrittenXml['item-graphic-gap']),
    },
    ...assets.map((a) => ({ name: `assets/${a.name}`, data: a.data })),
  ]);

  const parsed = await parseQtiPackage(zipBytes);
  expect(parsed.items.length).toStrictEqual(2);
  expect(parsed.assets.length).toStrictEqual(assets.length);
  if (!(parsed.items.some((it) => it.draft.type === 'hotspot'))) {
    expect.unreachable("Expected parsed.items.some((it) => it.draft.type === 'hotspot')");
  }
  if (!(parsed.items.some((it) => it.draft.type === 'graphic_gap_match'))) {
    expect.unreachable("Expected parsed.items.some((it) => it.draft.type === 'graphic_gap_match')");
  }
});

testCase('package export emits QTI 3 CSM standards metadata on item resources', () => {
  const parts: Part[] = [
    {
      id: 'part-1',
      title: 'Part',
      placements: [
        { id: 'pl-1', itemId: 'item-standards' },
        { id: 'pl-2', itemId: 'item-no-standards' },
      ],
    },
  ];

  const manifestXml = buildPackageManifestXml(
    'assessment-standards',
    parts,
    [],
    {},
    {
      'item-standards': [
        {
          standardId: '370850e6-46fa-11e7-9dcf-6ce999a3c328',
          code: 'MA.5.FR.1.1',
          label: 'Add and subtract fractions.',
          uri:
            'https://case.example.org/ims/case/v1p0/CFItems/370850e6-46fa-11e7-9dcf-6ce999a3c328',
          providerId: 'CASE',
        },
      ],
    },
  );

  expect(manifestXml).toContain(
    'xmlns:csm="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscsmd_v1p1"',
  );
  expect(manifestXml).toContain('<csm:curriculumStandardsMetadata providerId="CASE">');
  expect(manifestXml).toContain('<csm:label>MA.5.FR.1.1 Add and subtract fractions.</csm:label>');
  expect(manifestXml).toContain(
    '<csm:caseItemURI>https://case.example.org/ims/case/v1p0/CFItems/370850e6-46fa-11e7-9dcf-6ce999a3c328</csm:caseItemURI>',
  );
  expect(manifestXml).toContain('<csm:GUID>370850e6-46fa-11e7-9dcf-6ce999a3c328</csm:GUID>');
  expect(manifestXml).toContain(
    '<resource identifier="item-no-standards" type="imsqti_item_xmlv3p0" href="items/item-no-standards.xml">',
  );
});

testCase(
  'package export preserves catalog files and stylesheets as item dependencies',
  async () => {
    const sourceXml = injectItemMetadataIntoXml(
      exportQti3TestItemXml('single_select', defaultsSingleSelect(), {
        identifier: 'item-metadata',
      }),
      [{
        id: 'term-1',
        cards: [
          {
            support: { kind: 'predefined', value: 'keyword-translation' },
            entries: [{
              language: 'es',
              contentHtml: '<p>término</p>',
              files: [{ href: '/uploads/translation-audio', mimeType: 'audio/mpeg' }],
            }],
          },
          {
            support: { kind: 'predefined', value: 'long-description' },
            entries: [{
              language: 'en',
              files: [{ href: '/uploads/catalog-document', mimeType: 'text/html' }],
            }],
          },
        ],
      }],
      [{ href: '/uploads/item-stylesheet', type: 'text/css', media: 'screen' }],
    );
    const uploads = new Map([
      ['translation-audio', { id: 'translation-audio', name: 'term.mp3', type: 'audio/mpeg' }],
      ['item-stylesheet', { id: 'item-stylesheet', name: 'item.css', type: 'text/css' }],
      ['catalog-document', { id: 'catalog-document', name: 'term.html', type: 'text/html' }],
    ]);
    const bytes = new Map([
      ['translation-audio', new Uint8Array([1, 2, 3])],
      ['item-stylesheet', new TextEncoder().encode('.qti-item { color: black; }')],
      ['catalog-document', new TextEncoder().encode('<p>Long description</p>')],
    ]);
    const getUploadId = (value: string) => value.match(/\/uploads\/([a-z0-9-]+)/i)?.[1] ?? null;
    const collected = await collectPackageAssets({
      _tag: 'Items',
      itemsXml: { 'item-metadata': sourceXml },
    }, {
      getUploadId,
      getUpload: (id) => Promise.resolve(uploads.get(id) ?? null),
      readUploadFile: (upload) => Promise.resolve(bytes.get(upload.id) ?? new Uint8Array()),
    });

    if (!(collected.ok)) expect.unreachable('Expected collected.ok');
    const packaged = collected.value;
    expect(packaged.assets.length).toStrictEqual(3);
    expect(packaged.rewrittenXml['item-metadata']).toContain(
      'href="../assets/item-stylesheet-item.css"',
    );
    expect(packaged.rewrittenXml['item-metadata']).toContain(
      'src="../assets/translation-audio-term.mp3"',
    );
    expect(packaged.rewrittenXml['item-metadata']).toContain(
      '>../assets/catalog-document-term.html</qti-file-href>',
    );

    const parts: Part[] = [{
      id: 'part-1',
      title: 'Part',
      placements: [{ id: 'placement-1', itemId: 'item-metadata' }],
    }];
    const manifest = buildPackageManifestXml(
      'metadata-package',
      parts,
      packaged.assets,
      packaged.assetIdsByItem,
    );
    expect((manifest.match(/dependency identifierref="asset-/g) ?? []).length).toStrictEqual(3);

    const zipBytes = await writeZip([
      { name: 'imsmanifest.xml', data: new TextEncoder().encode(manifest) },
      {
        name: 'assessment.xml',
        data: new TextEncoder().encode(
          buildAssessmentTestXml({ id: 'metadata-package', title: 'Metadata' }, parts),
        ),
      },
      {
        name: 'items/item-metadata.xml',
        data: new TextEncoder().encode(packaged.rewrittenXml['item-metadata']),
      },
      ...packaged.assets.map((asset) => ({ name: `assets/${asset.name}`, data: asset.data })),
    ]);
    const imported = await parseQtiPackage(zipBytes);
    const draft = imported.items[0].draft;
    expect(draft.stylesheets?.[0].href).toStrictEqual('../assets/item-stylesheet-item.css');
    expect(draft.catalogs?.[0].cards[0].entries?.[0].language).toStrictEqual('es');
    expect(draft.catalogs?.[0].cards[0].entries?.[0].files?.[0].href).toStrictEqual(
      '../assets/translation-audio-term.mp3',
    );
    expect(draft.catalogs?.[0].cards[0].entries?.[0].contentHtml).toStrictEqual('<p>término</p>');
    expect(draft.catalogs?.[0].cards[1].entries?.[0].files?.[0].href).toStrictEqual(
      '../assets/catalog-document-term.html',
    );
    expect(imported.assets.length).toStrictEqual(3);
  },
);

testCase('package import preserves but warns about external stylesheets', async () => {
  const itemXml = exportQti3TestItemXml('single_select', defaultsSingleSelect(), {
    identifier: 'item-external-style',
  }).replace(
    /(<qti-item-body\b)/,
    '<qti-stylesheet href="https://cdn.example.org/item.css" type="text/css" media="screen" title="External"/>\n  $1',
  );
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="external-style-package">
  <organizations/>
  <resources>
    <resource identifier="item-external-style" type="imsqti_item_xmlv3p0" href="items/item.xml">
      <file href="items/item.xml"/>
    </resource>
  </resources>
</manifest>`;
  const imported = await parseQtiPackageEntries([
    { path: 'imsmanifest.xml', data: manifest },
    { path: 'items/item.xml', data: itemXml },
  ]);

  expect(imported.items[0].draft.stylesheets?.[0]).toStrictEqual({
    href: 'https://cdn.example.org/item.css',
    type: 'text/css',
    media: 'screen',
    title: 'External',
    attributes: {
      href: 'https://cdn.example.org/item.css',
      type: 'text/css',
      media: 'screen',
      title: 'External',
    },
  });
  expect(imported.warnings?.some((warning) => warning.code === 'QTI_METADATA_EXTERNAL_REFERENCE'))
    .toStrictEqual(true);
});

testCase('package collector rejects unretained media while allowing ordinary links', async () => {
  const deps = {
    getUploadId: () => null,
    getUpload: () => Promise.resolve(null),
    readUploadFile: () => Promise.resolve(new Uint8Array()),
  };
  for (const src of ['https://example.com/image.png', 'images/local.png']) {
    const result = await collectPackageAssets(
      { _tag: 'Items', itemsXml: { item: `<img src="${src}"/>` } },
      deps,
    );
    if (result.ok) expect.unreachable('Expected !result.ok');
    expect(result.error._tag).toStrictEqual('PackageAssetResolutionError');
  }
  const xml = '<a href="https://example.com">Reference</a><img src="data:image/png;base64,AA=="/>';
  const result = await collectPackageAssets({ _tag: 'Items', itemsXml: { item: xml } }, deps);
  if (!(result.ok)) expect.unreachable('Expected result.ok');
  expect(result.value.rewrittenXml.item).toStrictEqual(xml);
});

testCase(
  'root assessment resources share item bytes and own their manifest dependencies',
  async () => {
    const ids = ['image', 'video', 'captions', 'style', 'catalog'];
    const bytes = new Uint8Array([1, 2, 3]);
    const collected = await collectPackageAssets({
      _tag: 'Assessment',
      assessmentXml:
        '<test><img src="/uploads/image" alt="Diagram"/><video poster="/uploads/image"><source src="/uploads/video"/><track src="/uploads/captions"/></video><qti-stylesheet href="/uploads/style"/><qti-file-href>/uploads/catalog</qti-file-href><a href="https://example.org">Read more</a></test>',
      itemsXml: { item: '<img src="/uploads/image" alt="Diagram"/>' },
    }, {
      getUploadId: (value) => value.match(/^\/uploads\/([a-z]+)$/)?.[1] ?? null,
      getUpload: (id) => Promise.resolve(ids.includes(id) ? { id, name: `${id}.bin` } : null),
      readUploadFile: () => Promise.resolve(bytes),
    });
    if (!(collected.ok)) expect.unreachable('Expected collected.ok');
    const packaged = collected.value;
    expect(packaged.assets.length).toStrictEqual(5);
    expect(packaged.assetIdsByItem).toStrictEqual({ item: ['image'] });
    expect(packaged.assessmentAssetIds).toStrictEqual([
      'style',
      'catalog',
      'image',
      'video',
      'captions',
    ]);
    for (const id of ids) {
      expect(packaged.assessmentXml).toContain(`assets/${id}-${id}.bin`);
      expect(packaged.assets.find((asset) => asset.id === id)?.data).toStrictEqual(bytes);
    }
    expect(packaged.rewrittenXml.item).toContain('src="../assets/image-image.bin"');
    expect(packaged.assessmentXml).toContain('poster="assets/image-image.bin"');
    if (packaged.assessmentXml.includes('/uploads/')) {
      expect.unreachable("Expected !packaged.assessmentXml.includes('/uploads/')");
    }
    expect(packaged.assessmentXml).toContain('href="https://example.org"');
    const manifest = buildPackageManifestXml(
      'instructions',
      [{ id: 'part', title: 'Part', placements: [{ id: 'p', itemId: 'item' }] }],
      packaged.assets,
      packaged.assetIdsByItem,
      {},
      {},
      {},
      packaged.assessmentAssetIds,
    );
    const root = manifest.match(/<resource identifier="test-1"[\s\S]*?<\/resource>/)?.[0];
    if (!root) expect.unreachable('Expected root');
    expect((root.match(/identifierref="asset-/g) ?? []).length).toStrictEqual(5);
    expect((manifest.match(/identifierref="asset-/g) ?? []).length).toStrictEqual(6);
  },
);

testCase(
  'assessment asset failures are explicit and cancellation remains cancellation',
  async () => {
    const source = (assessmentXml: string) => ({
      _tag: 'Assessment' as const,
      assessmentXml,
      itemsXml: {},
    });
    const deps = {
      getUploadId: (value: string) => value === '/uploads/image' ? 'image' : null,
      getUpload: () => Promise.resolve(null),
      readUploadFile: () => Promise.resolve(new Uint8Array()),
    };
    for (
      const xml of [
        '<img src="/uploads/image"/>',
        '<img src="https://example.org/image.png"/>',
        '<video><source src="images/video.mp4"/></video>',
        '<video poster="https://example.org/poster.png"/>',
        '<qti-stylesheet href="https://example.org/style.css"/>',
        '<qti-file-href>catalog/file.html</qti-file-href>',
      ]
    ) {
      const result = await collectPackageAssets(source(xml), deps);
      if (result.ok) expect.unreachable('Expected !result.ok');
      expect(result.error._tag).toStrictEqual('PackageAssetResolutionError');
    }
    const failure = await collectPackageAssets(source('<img src="/uploads/image"/>'), {
      ...deps,
      getUpload: () => Promise.resolve({ id: 'image' }),
      readUploadFile: () => Promise.reject(new Error('private storage response')),
    });
    if (failure.ok) expect.unreachable('Expected !failure.ok');
    expect(failure.error.message).toStrictEqual('Referenced upload image could not be loaded.');
    expect(failure.error.cause instanceof Error).toStrictEqual(true);
    await expect(
      Promise.resolve().then(() =>
        collectPackageAssets(source('<img src="/uploads/image"/>'), {
          ...deps,
          getUpload: () => Promise.reject(new DOMException('Cancelled', 'AbortError')),
        })
      ),
    ).rejects.toSatisfy((caught: unknown) =>
      caught instanceof DOMException && caught.message.includes('Cancelled')
    );
  },
);
