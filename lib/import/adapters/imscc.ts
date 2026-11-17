import type { ImportedOrganizationGroup } from '../organization_groups.ts';
import { prepareCanvasMedia } from './canvas_media.ts';
import { discoverCanvasBanks } from './canvas_banks.ts';
import { aikenAdapter } from './aiken.ts';
import { blackboardAdapter } from './blackboard.ts';
import { giftAdapter } from './gift.ts';
import { moodleXmlAdapter } from './moodle_xml.ts';
import { migrateQtiResourceToImportResult } from './qti_migrator.ts';
import { qti12Adapter } from './qti12.ts';
import { qti21Adapter } from './qti21.ts';
import type { ZipArchive } from '../../zip_archive.ts';
import { IMPORT_ADAPTER_DESCRIPTORS } from '../adapter_descriptors.ts';
import { withImportArchive } from '../archive_policy.ts';
import { parseXml } from '../xml_dom.ts';
import {
  isAssessmentFile,
  type ManifestResource,
  parseManifestResources,
  selectAssessmentResource,
} from './imscc_resources.ts';
import type {
  ImportAdapter,
  ImportedAsset,
  ImportedItem,
  ImportedPart,
  ImportResult,
  ImportSource,
  ImportWarning,
  SniffResult,
} from '../types.ts';

const ZIP_MAGIC = [0x50, 0x4b];
const INNER_ADAPTERS: ImportAdapter[] = [
  blackboardAdapter,
  qti21Adapter,
  qti12Adapter,
  moodleXmlAdapter,
  giftAdapter,
  aikenAdapter,
];

export const imsccAdapter: ImportAdapter = {
  ...IMPORT_ADAPTER_DESCRIPTORS.imscc,
  sniff: sniffImscc,
  parse: parseImscc,
};

async function sniffImscc(source: ImportSource): Promise<SniffResult> {
  if (!isZip(source.bytes)) {
    return { supported: false, confidence: 0, reason: 'not-zip' };
  }

  const filename = (source.filename ?? '').toLowerCase();
  try {
    return await withImportArchive(source.bytes, (zip) => sniffImsccArchive(filename, zip));
  } catch (_err) {
    return { supported: false, confidence: 0, reason: 'invalid-zip' };
  }
}

async function sniffImsccArchive(filename: string, zip: ZipArchive): Promise<SniffResult> {
  const manifestFile = zip.file(/imsmanifest\.xml$/i)[0] ?? null;
  if (!manifestFile) {
    return { supported: false, confidence: 0.1, reason: 'missing-manifest' };
  }

  const manifestXml = await manifestFile.async('string');
  const lower = manifestXml.toLowerCase();
  const hasImsccMarker = lower.includes('imscc') || lower.includes('common cartridge') ||
    /imsqti_xmlv1p2\/imscc_/i.test(manifestXml);

  if (!hasImsccMarker && !filename.endsWith('.imscc')) {
    return { supported: false, confidence: 0.2, reason: 'manifest-not-imscc' };
  }

  const confidence = hasImsccMarker ? 0.92 : 0.8;
  return {
    supported: true,
    confidence,
    reason: hasImsccMarker ? 'imscc-markers' : 'imscc-extension',
  };
}

async function parseImscc(source: ImportSource): Promise<ImportResult> {
  if (!isZip(source.bytes)) {
    throw new Error('IMSCC import expects a cartridge zip file.');
  }

  return await withImportArchive(source.bytes, parseImsccArchive);
}

async function parseImsccArchive(zip: ZipArchive): Promise<ImportResult> {
  const manifestFile = zip.file(/imsmanifest\.xml$/i)[0] ?? null;
  if (!manifestFile) throw new Error('imsmanifest.xml not found in cartridge');

  const manifestXml = await manifestFile.async('string');
  const manifestDoc = parseXml(manifestXml, 'imscc-manifest');
  const resources = parseManifestResources(manifestDoc);
  const assessmentResources = resources.filter((resource) => isAssessmentResource(resource.type));
  const bankDiscovery = await discoverCanvasBanks(zip, resources, assessmentResources);
  assessmentResources.push(...bankDiscovery.banks);
  if (!assessmentResources.length) {
    throw new Error('Cartridge contains no assessment resources.');
  }

  const warnings: ImportWarning[] = [...bankDiscovery.warnings];
  const assetsByPath = new Map<string, ImportedAsset>();
  const seenIdentifiers = new Set<string>();
  const seenHrefs = new Set<string>();
  const items: ImportedItem[] = [];
  const parts: ImportedPart[] = [];
  const organizationGroups: ImportedOrganizationGroup[] = [];

  for (let index = 0; index < assessmentResources.length; index += 1) {
    const resource = assessmentResources[index];
    const resourceKey = sanitizeSegment(resource.identifier || `resource_${index + 1}`);
    const selected = await selectAssessmentResource(zip, resource, resources);
    if (!selected.ok) {
      warnings.push(selected.warning);
      continue;
    }
    warnings.push(...selected.warnings);
    const { primaryPath, paths: existingPaths } = selected;

    const primaryFile = zip.file(primaryPath);
    if (!primaryFile) {
      warnings.push({
        code: 'IMSCC_RESOURCE_MISSING',
        message: `Assessment file ${primaryPath} could not be read from cartridge.`,
      });
      continue;
    }

    const primaryBytes = await primaryFile.async('uint8array');
    const imported = await parseAssessmentFile(
      zip,
      resource,
      primaryPath,
      primaryBytes,
      existingPaths,
      resources,
      warnings,
    );
    if (!imported) continue;

    for (const filePath of existingPaths) {
      if (filePath === primaryPath || isAssessmentFile(filePath)) continue;
      const file = zip.file(filePath);
      if (!file) continue;
      const data = await file.async('uint8array');
      addAsset(
        assetsByPath,
        {
          path: filePath,
          name: filePath.split('/').pop() || filePath,
          data,
        },
        warnings,
        resourceKey,
      );
    }

    for (const asset of imported.assets) {
      addAsset(assetsByPath, asset, warnings, resourceKey);
    }

    const hrefMap = new Map<string, string>();
    for (const item of imported.items) {
      const uniqueIdentifier = uniqueId(item.identifier || `${resourceKey}_item`, seenIdentifiers);
      const uniqueHref = uniquePath(item.href || `${uniqueIdentifier}.xml`, seenHrefs);
      hrefMap.set(item.href, uniqueHref);
      items.push({
        ...item,
        identifier: uniqueIdentifier,
        href: uniqueHref,
      });
    }

    // Retain source organization independently of delivery parts and scope it to this resource.
    imported.organizationGroups.forEach((group, groupIndex) => {
      organizationGroups.push({
        id: `imscc-resource-${index + 1}-group-${groupIndex + 1}`,
        title: group.title,
        hrefs: group.hrefs.map((href) => {
          const mapped = hrefMap.get(href);
          if (mapped === undefined) {
            throw new Error('Imported organization group references an unavailable question.');
          }
          return mapped;
        }),
      });
    });

    const sourceParts: ImportedPart[] = imported.parts.length ? imported.parts : [{
      id: `part-${index + 1}`,
      title: `Part ${index + 1}`,
      placements: imported.items.map((it) => ({ href: it.href })),
    }];

    sourceParts.forEach((part, partIndex) => {
      const partId = uniqueId(
        sanitizeSegment(part.id || `${resourceKey}_part_${partIndex + 1}`),
        new Set(parts.map((p) => p.id)),
      );
      const partTitle = resource.title || part.title || `Part ${parts.length + 1}`;
      const mappedPlacements = (part.placements ?? [])
        .map((placement) =>
          'content' in placement ? placement : ({
            ...placement,
            href: hrefMap.get(placement.href) ?? placement.href,
          })
        )
        .filter((placement) => 'content' in placement || Boolean(placement.href));

      if (!mappedPlacements.length) return;
      parts.push({
        id: partId,
        title: partTitle,
        placements: mappedPlacements,
        options: part.options,
      });
    });

    for (const warning of imported.warnings ?? []) {
      warnings.push({
        ...warning,
        path: warning.path ? hrefMap.get(warning.path) ?? warning.path : undefined,
      });
    }
  }

  if (
    !items.length &&
    !parts.some((part) => part.placements.some((placement) => 'content' in placement))
  ) {
    throw new Error('No assessment items could be imported from cartridge resources.');
  }

  const finalParts = parts.length
    ? parts
    : [{ id: 'part-1', title: 'Part 1', placements: items.map((item) => ({ href: item.href })) }];

  return {
    title: 'Imported Common Cartridge',
    parts: finalParts,
    organizationGroups,
    items,
    assets: Array.from(assetsByPath.values()),
    warnings: warnings.length ? warnings : undefined,
  };
}

async function parseAssessmentFile(
  zip: ZipArchive,
  resource: ManifestResource,
  path: string,
  bytes: Uint8Array,
  existingPaths: readonly string[],
  resources: readonly ManifestResource[],
  warnings: ImportWarning[],
): Promise<ImportResult | null> {
  if (isQti12Resource(resource.type)) {
    try {
      return await parseQti12Resource(zip, resource, path, existingPaths, resources, warnings);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse QTI resource';
      warnings.push({
        code: 'IMSCC_PARSE_FAILED',
        message,
        path,
      });
      return null;
    }
  }

  const source: ImportSource = {
    filename: path.split('/').pop() || path,
    bytes,
    mime: mimeFromPath(path),
  };

  const detection = await detectInnerAdapter(source);
  if (!detection) {
    warnings.push({
      code: 'IMSCC_UNRECOGNIZED_ASSESSMENT',
      message: `Unsupported assessment file in cartridge: ${path}`,
      path,
    });
    return null;
  }

  try {
    return await detection.adapter.parse(source, detection.sniff.hint);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse assessment file';
    warnings.push({
      code: 'IMSCC_PARSE_FAILED',
      message,
      path,
    });
    return null;
  }
}

async function parseQti12Resource(
  zip: ZipArchive,
  resource: ManifestResource,
  sourcePath: string,
  existingPaths: readonly string[],
  resources: readonly ManifestResource[],
  warnings: ImportWarning[],
): Promise<ImportResult | null> {
  const prepared = await prepareCanvasMedia(zip, resources, sourcePath, existingPaths);
  if (!prepared.ok) {
    warnings.push(prepared.warning);
    return null;
  }
  const result = await migrateQtiResourceToImportResult({
    sourcePath,
    title: resource.title || resource.identifier || sourcePath,
    files: prepared.files,
  });
  if (!result.ok) {
    warnings.push(...result.warnings);
    return null;
  }
  return result.imported;
}

async function detectInnerAdapter(
  source: ImportSource,
): Promise<{ adapter: ImportAdapter; sniff: SniffResult } | null> {
  const checks = await Promise.all(
    INNER_ADAPTERS.map(async (adapter, index) => {
      try {
        const sniff = await adapter.sniff(source);
        return { adapter, sniff, index };
      } catch {
        return { adapter, sniff: { supported: false, confidence: 0 }, index };
      }
    }),
  );

  const supported = checks.filter((entry) => entry.sniff.supported);
  if (!supported.length) return null;

  supported.sort((a, b) => {
    if (b.sniff.confidence !== a.sniff.confidence) return b.sniff.confidence - a.sniff.confidence;
    if (b.adapter.priority !== a.adapter.priority) return b.adapter.priority - a.adapter.priority;
    return a.index - b.index;
  });

  return { adapter: supported[0].adapter, sniff: supported[0].sniff };
}

function isAssessmentResource(type: string): boolean {
  const normalized = (type ?? '').toLowerCase();
  return normalized.includes('assessment') || normalized.includes('imsqti');
}

function isQti12Resource(type: string): boolean {
  const normalized = (type ?? '').toLowerCase();
  return normalized.includes('imsqti') && normalized.includes('v1p2');
}

function addAsset(
  map: Map<string, ImportedAsset>,
  asset: ImportedAsset,
  warnings: ImportWarning[],
  resourceKey: string,
): void {
  const normalizedPath = normalizePath(asset.path || asset.name);
  if (!normalizedPath) return;

  const existing = map.get(normalizedPath);
  if (!existing) {
    map.set(normalizedPath, { ...asset, path: normalizedPath });
    return;
  }

  if (sameBytes(existing.data, asset.data)) return;

  const prefixedPath = normalizePath(`${resourceKey}/${normalizedPath}`);
  map.set(prefixedPath, {
    ...asset,
    path: prefixedPath,
    name: asset.name || prefixedPath.split('/').pop() || prefixedPath,
  });
  warnings.push({
    code: 'IMSCC_ASSET_COLLISION',
    message: `Asset path collision for ${normalizedPath}; imported duplicate as ${prefixedPath}.`,
    path: normalizedPath,
  });
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function uniqueId(base: string, seen: Set<string>): string {
  let id = sanitizeSegment(base) || 'item';
  let counter = 1;
  while (seen.has(id)) {
    counter += 1;
    id = `${sanitizeSegment(base) || 'item'}_${counter}`;
  }
  seen.add(id);
  return id;
}

function uniquePath(base: string, seen: Set<string>): string {
  const cleaned = normalizePath(base) || 'item.xml';
  const dot = cleaned.lastIndexOf('.');
  const prefix = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const ext = dot > 0 ? cleaned.slice(dot) : '';
  let value = cleaned;
  let counter = 1;
  while (seen.has(value)) {
    counter += 1;
    value = `${prefix}_${counter}${ext}`;
  }
  seen.add(value);
  return value;
}

function sanitizeSegment(value: string): string {
  return (value ?? '').trim().replace(/[^A-Za-z0-9_.-]/g, '_');
}

function mimeFromPath(path: string): string | undefined {
  if (/\.xml$/i.test(path) || /\.dat$/i.test(path)) return 'application/xml';
  if (/\.txt$/i.test(path)) return 'text/plain';
  return undefined;
}

function normalizePath(path: string): string {
  return (path ?? '').replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1];
}
