import type { ZipArchive } from '../../zip_archive.ts';
import type { ImportWarning } from '../types.ts';
import { attr, findAllDescendantsByLocalName, localName, parseXmlStrict } from '../xml_dom.ts';
import { isCanvasNativePath, type ManifestResource } from './imscc_resources.ts';

/** Discover explicitly declared Canvas question banks outside quiz dependency closures. */
export async function discoverCanvasBanks(
  zip: ZipArchive,
  resources: readonly ManifestResource[],
  assessments: readonly ManifestResource[],
): Promise<{ readonly banks: ManifestResource[]; readonly warnings: ImportWarning[] }> {
  const claimed = new Set<string>();
  const byId = new Map(resources.map((resource) => [resource.identifier, resource]));
  const pending = [...assessments];
  while (pending.length) {
    const resource = pending.pop();
    if (!resource || claimed.has(resource.identifier)) continue;
    claimed.add(resource.identifier);
    for (const id of resource.dependencies) {
      const dependency = byId.get(id);
      if (dependency) pending.push(dependency);
    }
  }
  const banks: ManifestResource[] = [];
  const warnings: ImportWarning[] = [];
  for (const resource of resources) {
    if (
      claimed.has(resource.identifier) ||
      !resource.type.toLowerCase().startsWith('associatedcontent/')
    ) continue;
    const paths = [
      ...new Set([resource.href, resource.file, ...resource.fileRefs].filter(isCanvasNativePath)),
    ];
    if (!paths.length) continue;
    const path = paths[0];
    const file = zip.file(path);
    if (paths.length !== 1 || !file) {
      warnings.push({
        code: 'IMSCC_RESOURCE_UNSUPPORTED',
        message:
          `Canvas bank ${resource.identifier} needs one available native question file. Inspect the original package.`,
      });
      continue;
    }
    let document: Document;
    try {
      document = parseXmlStrict(await file.async('string'), 'Canvas question bank');
    } catch {
      warnings.push({
        code: 'IMSCC_RESOURCE_UNSUPPORTED',
        message:
          `Canvas bank ${resource.identifier} contains invalid XML. Correct the source and import it again.`,
      });
      continue;
    }
    const root = document.documentElement;
    const objectbanks = findAllDescendantsByLocalName(root, 'objectbank');
    if (
      localName(root) !== 'questestinterop' || objectbanks.length !== 1 ||
      !findAllDescendantsByLocalName(objectbanks[0], 'item').length
    ) {
      warnings.push({
        code: 'IMSCC_RESOURCE_UNSUPPORTED',
        message:
          `Canvas bank ${resource.identifier} contains no usable question bank. Inspect the original package.`,
      });
      continue;
    }
    const titleField = findAllDescendantsByLocalName(objectbanks[0], 'qtimetadatafield').find((
      field,
    ) =>
      findAllDescendantsByLocalName(field, 'fieldlabel')[0]?.textContent?.trim() === 'bank_title'
    );
    const title = titleField
      ? findAllDescendantsByLocalName(titleField, 'fieldentry')[0]?.textContent?.trim()
      : '';
    // This content-verified associated resource enters the same QTI 1.2 conversion path as quizzes.
    banks.push({
      ...resource,
      type: 'imsqti_xmlv1p2',
      href: path,
      title: title || attr(objectbanks[0], 'ident') || resource.identifier,
    });
  }
  return { banks, warnings };
}
