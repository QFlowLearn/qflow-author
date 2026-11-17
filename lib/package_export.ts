import { assessmentQuestionPlacements } from './assessment_content.ts';
import type { OrganizationByItem } from './organization_transfer.ts';
import { organizationCatalogXml, organizationItemXml } from './organization_transfer_xml.ts';
import { ASSET_ATTR_REGEX, QTI_FILE_HREF_REGEX, QTI_STYLESHEET_HREF_REGEX } from './asset_refs.ts';
import type { CurriculumStandardAlignment, StandardsByItem } from './standards.ts';
import { xmlEscape } from './xml.ts';
import type { Part } from './test_export.ts';
import { parseQuestionTags, type TagsByItem } from './question_tags.ts';

export type PackageAsset = { id: string; name: string; mime?: string; data: Uint8Array };
export type UploadMeta = { id: string; name?: string | null; type?: string | null };
export type AssetDepsByItem = Record<string, string[]>;

type ItemPackageSources = {
  readonly _tag: 'Items';
  readonly itemsXml: Readonly<Record<string, string>>;
};
type AssessmentPackageSources = {
  readonly _tag: 'Assessment';
  readonly assessmentXml: string;
  readonly itemsXml: Readonly<Record<string, string>>;
};
type AssetDependencies<U extends UploadMeta> = {
  readonly getUploadId: (value: string) => string | null;
  readonly getUpload: (id: string) => Promise<U | null>;
  readonly readUploadFile: (upload: U) => Promise<Uint8Array>;
};
type PackagedItemAssets = {
  readonly assets: PackageAsset[];
  readonly rewrittenXml: Record<string, string>;
  readonly assetIdsByItem: AssetDepsByItem;
};

/** One collected inventory with correct references for the root test and nested question files. */
export type PackagedAssessmentAssets = PackagedItemAssets & {
  readonly assessmentXml: string;
  readonly assessmentAssetIds: readonly string[];
};

const CSM_NAMESPACE = 'http://www.imsglobal.org/xsd/qti/qtiv3p0/imscsmd_v1p1';
const LOM_NAMESPACE = 'http://ltsc.ieee.org/xsd/LOM';

/** Expected failure when a canonical item references an asset that cannot be packaged. */
export class PackageAssetResolutionError extends Error {
  readonly _tag = 'PackageAssetResolutionError' as const;

  constructor(
    message: string,
    readonly reason: 'unsupported_reference' | 'upload_missing' | 'upload_unavailable',
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PackageAssetResolutionError';
  }
}

type PackageAssetCollection<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PackageAssetResolutionError };

/** Collect assessment instructions and questions through one tenant-owned upload inventory. */
export function collectPackageAssets<U extends UploadMeta>(
  source: AssessmentPackageSources,
  opts: AssetDependencies<U>,
): Promise<PackageAssetCollection<PackagedAssessmentAssets>>;
/** Collect a question-only resource set for a bank package. */
export function collectPackageAssets<U extends UploadMeta>(
  source: ItemPackageSources,
  opts: AssetDependencies<U>,
): Promise<PackageAssetCollection<PackagedItemAssets>>;
/** Rewrite each resource relative to its explicit archive location while sharing asset bytes. */
export async function collectPackageAssets<U extends UploadMeta>(
  source: ItemPackageSources | AssessmentPackageSources,
  opts: AssetDependencies<U>,
): Promise<PackageAssetCollection<PackagedItemAssets | PackagedAssessmentAssets>> {
  const assets: PackageAsset[] = [];
  const assetNameById = new Map<string, string>();
  const assetIdsByItem: AssetDepsByItem = {};
  const rewrittenXml: Record<string, string> = {};

  async function collectResource(
    xml: string,
    assetDirectory: 'assets' | '../assets',
  ): Promise<PackageAssetCollection<{ readonly xml: string; readonly assetIds: string[] }>> {
    const upIds = new Set<string>();
    for (const match of xml.matchAll(QTI_STYLESHEET_HREF_REGEX)) {
      const uploadId = opts.getUploadId(match[3]);
      if (!uploadId) {
        return assetFailure(
          'unsupported_reference',
          'A stylesheet is not backed by an uploaded package file.',
        );
      }
      upIds.add(uploadId);
    }
    for (const match of xml.matchAll(QTI_FILE_HREF_REGEX)) {
      const uploadId = opts.getUploadId(match[2]);
      if (!uploadId) {
        return assetFailure(
          'unsupported_reference',
          'A catalog file is not backed by an uploaded package file.',
        );
      }
      upIds.add(uploadId);
    }
    for (const m of xml.matchAll(ASSET_ATTR_REGEX)) {
      const value = m[3];
      const uploadId = opts.getUploadId(value);
      if (uploadId) upIds.add(uploadId);
      else if (
        !['href', 'xlink:href'].includes(m[1].toLowerCase()) &&
        !value.startsWith('data:') && !value.startsWith('#')
      ) {
        return assetFailure(
          'unsupported_reference',
          'A media resource is not backed by an uploaded package file.',
        );
      }
    }
    for (const upId of upIds) {
      if (assetNameById.has(upId)) continue;
      // Metadata and byte reads use the existing exception-based persistence/storage seam.
      try {
        const rec = await opts.getUpload(upId);
        if (!rec) return assetFailure('upload_missing', `Referenced upload ${upId} is missing.`);
        const baseName = String(rec.name || `${upId}.bin`).replace(/[^A-Za-z0-9_.\-]/g, '_');
        const name = `${upId}-${baseName}`;
        const data = await opts.readUploadFile(rec);
        assets.push({ id: upId, name, mime: rec.type ?? undefined, data });
        assetNameById.set(upId, name);
      } catch (cause: unknown) {
        if (cause instanceof Error && cause.name === 'AbortError') throw cause;
        return assetFailure(
          'upload_unavailable',
          `Referenced upload ${upId} could not be loaded.`,
          cause,
        );
      }
    }

    const assetIds = Array.from(upIds);

    const rewrittenStylesheets = xml.replace(
      QTI_STYLESHEET_HREF_REGEX,
      (match, prefix, quote, value) => {
        const uploadId = opts.getUploadId(value);
        if (!uploadId) return match;
        const name = assetNameById.get(uploadId);
        if (!name) throw new Error('A collected stylesheet has no package asset.');
        return `${prefix}${quote}${assetDirectory}/${name}${quote}`;
      },
    );
    const rewrittenAttributes = rewrittenStylesheets.replace(
      ASSET_ATTR_REGEX,
      (match, attr, quote, value) => {
        const uploadId = opts.getUploadId(value);
        if (!uploadId) return match;
        const name = assetNameById.get(uploadId);
        if (!name) throw new Error('A collected resource has no package asset.');
        return `${attr}=${quote}${assetDirectory}/${name}${quote}`;
      },
    );
    const rewritten = rewrittenAttributes.replace(
      QTI_FILE_HREF_REGEX,
      (match, open, value, close) => {
        const uploadId = opts.getUploadId(value);
        if (!uploadId) return match;
        const name = assetNameById.get(uploadId);
        if (!name) throw new Error('A collected catalog file has no package asset.');
        return `${open}${assetDirectory}/${name}${close}`;
      },
    );
    return { ok: true, value: { xml: rewritten, assetIds } };
  }
  for (const [itemId, xml] of Object.entries(source.itemsXml)) {
    const resource = await collectResource(xml, '../assets');
    if (!resource.ok) return resource;
    rewrittenXml[itemId] = resource.value.xml;
    if (resource.value.assetIds.length) assetIdsByItem[itemId] = resource.value.assetIds;
  }
  if (source._tag === 'Assessment') {
    const assessment = await collectResource(source.assessmentXml, 'assets');
    if (!assessment.ok) return assessment;
    return {
      ok: true,
      value: {
        assets,
        rewrittenXml,
        assetIdsByItem,
        assessmentXml: assessment.value.xml,
        assessmentAssetIds: assessment.value.assetIds,
      },
    };
  }

  return { ok: true, value: { assets, rewrittenXml, assetIdsByItem } };
}

function assetFailure(
  reason: PackageAssetResolutionError['reason'],
  message: string,
  cause?: unknown,
): {
  readonly ok: false;
  readonly error: PackageAssetResolutionError;
} {
  return { ok: false, error: new PackageAssetResolutionError(message, reason, cause) };
}

/** Write manifest resources and dependencies for every packaged assessment and question asset. */
export function buildPackageManifestXml(
  id: string,
  parts: Part[],
  assets: PackageAsset[],
  assetIdsByItem: AssetDepsByItem = {},
  standardsByItem: StandardsByItem = {},
  tagsByItem: TagsByItem = {},
  organizationByItem: OrganizationByItem = {},
  assessmentAssetIds: readonly string[] = [],
): string {
  const catalogXml = organizationCatalogXml(organizationByItem);
  const testHref = 'assessment.xml';
  const items = Array.from(
    new Set(
      parts.flatMap((p) => assessmentQuestionPlacements(p.placements).map((pl) => pl.itemId)),
    ),
  );
  const assetIdentifierById = new Map<string, string>();
  assets.forEach((a, i) => assetIdentifierById.set(a.id, `asset-${i + 1}`));
  const assessmentDependencies = assessmentAssetIds.map((id) => {
    const identifier = assetIdentifierById.get(id);
    if (!identifier) throw new Error('Assessment refers to an uncollected package asset.');
    return `\n      <dependency identifierref="${xmlEscape(identifier)}"/>`;
  }).join('');
  const hasStandards = Object.values(standardsByItem).some((standards) => standards.length > 0);
  const hasTags = Object.values(tagsByItem).some((tags) => tags.length > 0);

  const itemResources = items.map((iid) => {
    const deps = (assetIdsByItem[iid] ?? [])
      .map((id) => assetIdentifierById.get(id))
      .filter((v): v is string => Boolean(v));
    const depsXml = deps.length
      ? `\n${deps.map((dep) => `      <dependency identifierref="${xmlEscape(dep)}"/>`).join('\n')}`
      : '';
    const standardsXml = buildItemStandardsMetadataXml(standardsByItem[iid] ?? []);
    const tags = parseQuestionTags(tagsByItem[iid]);
    const tagsXml = tags.length
      ? `<lom:general>${
        tags.map((tag) => `<lom:keyword><lom:string>${xmlEscape(tag)}</lom:string></lom:keyword>`)
          .join('')
      }</lom:general>`
      : '';
    const organizationXml = organizationItemXml(organizationByItem[iid]);
    const lomXml = tagsXml || organizationXml
      ? `<lom:lom xmlns:lom="${LOM_NAMESPACE}">${tagsXml}${organizationXml}</lom:lom>`
      : '';
    const metadataXml = standardsXml || lomXml
      ? `\n      <metadata>${standardsXml}${lomXml}</metadata>`
      : '';
    return `    <resource identifier="${xmlEscape(iid)}" type="imsqti_item_xmlv3p0" href="items/${
      xmlEscape(iid)
    }.xml">${metadataXml}\n      <file href="items/${
      xmlEscape(iid)
    }.xml"/>${depsXml}\n    </resource>`;
  }).join('\n');

  const assetResources = assets.map((a, i) =>
    `    <resource identifier="asset-${i + 1}" type="webcontent" href="assets/${
      xmlEscape(a.name)
    }">\n      <file href="assets/${xmlEscape(a.name)}"/>\n    </resource>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"${
  hasStandards ? ` xmlns:csm="${CSM_NAMESPACE}"` : ''
}${
  hasTags ? ` xmlns:lom="${LOM_NAMESPACE}"` : ''
} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqtiv3p0_imscpv1p2_v1p0.xsd${
    hasStandards
      ? ` ${CSM_NAMESPACE} https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqtiv3p0_csmv1p1_v1p0.xsd`
      : ''
  }"
  identifier="pkg-${xmlEscape(id)}">
  <metadata>
    <schema>QTI Package</schema>
    <schemaversion>3.0.0</schemaversion>
    ${catalogXml}
  </metadata>
  <organizations/>
  <resources>
    <resource identifier="test-1" type="imsqti_test_xmlv3p0" href="${testHref}">
      <file href="${testHref}"/>
${
  items.map((iid) => `      <dependency identifierref="${xmlEscape(String(iid))}"/>`).join(
    '\n',
  )
}${assessmentDependencies}
    </resource>
${itemResources}
${assetResources}
  </resources>
</manifest>`;
}

function buildItemStandardsMetadataXml(standards: CurriculumStandardAlignment[]): string {
  if (!standards.length) return '';

  const byProvider = new Map<string, CurriculumStandardAlignment[]>();
  for (const standard of standards) {
    const provider = standard.providerId?.trim() || '';
    const providerStandards = byProvider.get(provider) ?? [];
    providerStandards.push(standard);
    byProvider.set(provider, providerStandards);
  }

  const entries = [...byProvider.entries()].map(([providerId, providerStandards]) => {
    const providerAttr = providerId ? ` providerId="${xmlEscape(providerId)}"` : '';
    const guids = providerStandards.map((standard) => {
      const label = formatStandardLabel(standard);
      const labelXml = label ? `\n                <csm:label>${xmlEscape(label)}</csm:label>` : '';
      const uriXml = standard.uri
        ? `\n                <csm:caseItemURI>${xmlEscape(standard.uri)}</csm:caseItemURI>`
        : '';
      return `              <csm:labelledGUID>${labelXml}${uriXml}
                <csm:GUID>${xmlEscape(standard.standardId)}</csm:GUID>
              </csm:labelledGUID>`;
    }).join('\n');

    return `          <csm:curriculumStandardsMetadata${providerAttr}>
            <csm:setOfGUIDs>
${guids}
            </csm:setOfGUIDs>
          </csm:curriculumStandardsMetadata>`;
  }).join('\n');

  return `
        <csm:curriculumStandardsMetadataSet>
${entries}
        </csm:curriculumStandardsMetadataSet>`;
}

function formatStandardLabel(standard: CurriculumStandardAlignment): string | null {
  const code = standard.code?.trim();
  const label = standard.label?.trim();
  if (code && label && label !== code && !label.startsWith(`${code} `)) {
    return `${code} ${label}`;
  }
  return label || code || standard.standardId;
}
