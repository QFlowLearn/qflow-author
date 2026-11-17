import {
  ORGANIZATION_NAMESPACE,
  type OrganizationTransfer,
  parseOrganizationTransfer,
} from '../../../organization_transfer.ts';
import type { PackageZipSource } from '../../package_zip_source.ts';
import { childElements, parseXmlStrict } from '../../xml_dom.ts';
import { MAX_NATIVE_QTI_ENTRY_BYTES } from '../../../source_intake/policy.ts';
import { parseQuestionTags } from '../../../question_tags.ts';

const CP = 'http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1';
const LOM = 'http://ltsc.ieee.org/xsd/LOM';

/** Read resource keywords and the explicit organization contract; core owns the resource graph. */
export async function readPackageMetadata(
  source: PackageZipSource,
): Promise<
  {
    tags: ReadonlyMap<string, readonly string[]>;
    organization: ReadonlyMap<string, OrganizationTransfer>;
  }
> {
  const organization = new Map<string, OrganizationTransfer>();
  // Missing manifests are reported by the canonical package parser.
  if (!source.entries.some((entry) => entry.path === 'imsmanifest.xml')) {
    return { tags: new Map(), organization };
  }
  const bytes = await source.readEntry('imsmanifest.xml', MAX_NATIVE_QTI_ENTRY_BYTES);
  const root = parseXmlStrict(new TextDecoder().decode(bytes), 'QTI item metadata').documentElement;
  const result = new Map<string, readonly string[]>();
  if (root.namespaceURI !== CP || root.localName !== 'manifest') {
    return { tags: result, organization };
  }
  const catalogs = children(root, CP, 'metadata')
    .flatMap((m) => children(m, LOM, 'lom'))
    .flatMap((m) => children(m, ORGANIZATION_NAMESPACE, 'organization-catalog'));
  if (catalogs.length > 1) throw new Error('Repeated organization catalog.');
  const catalog: unknown = catalogs.length ? JSON.parse(catalogs[0].textContent ?? '') : null;
  const versions = new Map<string, unknown>();
  if (catalog !== null) {
    if (
      !record(catalog) || Object.keys(catalog).sort().join(',') !== 'schema,vocabularies' ||
      catalog.schema !== 'qflow.organization.v1' || !Array.isArray(catalog.vocabularies) ||
      catalog.vocabularies.length > 1000
    ) throw new Error('Invalid organization catalog.');
    for (const vocabulary of catalog.vocabularies) {
      if (
        !record(vocabulary) || typeof vocabulary.versionId !== 'string' ||
        versions.has(vocabulary.versionId)
      ) throw new Error('Invalid organization catalog identity.');
      versions.set(vocabulary.versionId, vocabulary);
    }
  }
  for (const resources of children(root, CP, 'resources')) {
    for (const resource of children(resources, CP, 'resource')) {
      if (resource.getAttribute('type') !== 'imsqti_item_xmlv3p0') continue;
      const tags = children(resource, CP, 'metadata')
        .flatMap((metadata) => children(metadata, LOM, 'lom'))
        .flatMap((lom) => children(lom, LOM, 'general'))
        .flatMap((general) => children(general, LOM, 'keyword'))
        .flatMap((keyword) => children(keyword, LOM, 'string'))
        .map((value) => value.textContent ?? '');
      const id = resource.getAttribute('identifier');
      if (!id || result.has(id)) throw new Error('Invalid QTI tag resource identity.');
      result.set(id, parseQuestionTags(tags));
      const nodes = children(resource, CP, 'metadata')
        .flatMap((m) => children(m, LOM, 'lom'))
        .flatMap((m) => children(m, ORGANIZATION_NAMESPACE, 'organization'));
      if (nodes.length > 1) throw new Error('Repeated item organization metadata.');
      if (nodes.length) {
        const raw: unknown = JSON.parse(nodes[0].textContent ?? '');
        if (
          !record(raw) || Object.keys(raw).sort().join(',') !== 'assignments,schema' ||
          !Array.isArray(raw.assignments)
        ) throw new Error('Invalid item organization metadata.');
        const ids = new Set(raw.assignments.map((a) => {
          if (!record(a) || typeof a.versionId !== 'string') {
            throw new Error('Invalid organization version reference.');
          }
          return a.versionId;
        }));
        organization.set(
          id,
          parseOrganizationTransfer({
            ...raw,
            vocabularies: [...ids].map((versionId) => versions.get(versionId)),
          }),
        );
      }
    }
  }
  return { tags: result, organization };
}

function children(element: Element, namespace: string, name: string): Element[] {
  return childElements(element).filter((child) =>
    child.namespaceURI === namespace && child.localName === name
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
