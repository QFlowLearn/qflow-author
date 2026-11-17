import type { ZipArchive } from '../../zip_archive.ts';
import { normalizePath } from '../package_paths.ts';
import type { ImportWarning } from '../types.ts';
import {
  attr,
  childElements,
  findAllDescendantsByLocalName,
  localName,
  parseXml,
} from '../xml_dom.ts';

/** One declared cartridge resource and its explicit dependency edges. */
export type ManifestResource = {
  readonly identifier: string;
  readonly title?: string;
  readonly type: string;
  readonly baseurl: string;
  readonly href: string;
  readonly file: string;
  readonly fileRefs: readonly string[];
  readonly dependencies: readonly string[];
};

/** Parse manifest declarations once, retaining dependency ownership. */
export function parseManifestResources(doc: Document): ManifestResource[] {
  return findAllDescendantsByLocalName(doc.documentElement ?? doc, 'resource').map((element) => ({
    identifier: attr(element, 'identifier') ?? '',
    type: attr(element, 'type') ?? '',
    baseurl: normalizePath(attr(element, 'baseurl') ?? ''),
    href: normalizePath(attr(element, 'href') ?? ''),
    file: normalizePath(attr(element, 'file') ?? ''),
    fileRefs: childElements(element).filter((child) => localName(child) === 'file')
      .map((child) => normalizePath(attr(child, 'href') ?? '')).filter(Boolean),
    dependencies: childElements(element).filter((child) => localName(child) === 'dependency')
      .map((child) => attr(child, 'identifierref') ?? ''),
  }));
}

type ResourceSelection =
  | {
    readonly ok: true;
    readonly primaryPath: string;
    readonly paths: string[];
    readonly warnings: ImportWarning[];
  }
  | { readonly ok: false; readonly warning: ImportWarning };

/** Select one authoritative assessment payload and the files in its manifest dependency closure. */
export async function selectAssessmentResource(
  zip: ZipArchive,
  resource: ManifestResource,
  resources: readonly ManifestResource[],
): Promise<ResourceSelection> {
  const byId = new Map(resources.map((entry) => [entry.identifier, entry]));
  if (byId.size !== resources.length) {
    return unsupported(resource, 'Manifest resource identifiers are duplicated.');
  }
  const closure: ManifestResource[] = [];
  const pending = [resource];
  const visited = new Set<string>();
  while (pending.length) {
    const entry = pending.pop();
    if (!entry || visited.has(entry.identifier)) continue;
    visited.add(entry.identifier);
    closure.push(entry);
    for (const identifier of entry.dependencies) {
      const dependency = byId.get(identifier);
      if (!dependency) {
        return unsupported(resource, `Declared dependency ${identifier} is missing.`);
      }
      pending.push(dependency);
    }
  }
  const native = [
    ...new Set(
      closure.filter((entry) =>
        entry !== resource && entry.type.toLowerCase().startsWith('associatedcontent/')
      )
        .flatMap((entry) => [entry.href, ...entry.fileRefs]).filter(isCanvasNativePath),
    ),
  ];
  if (native.length > 1) {
    return unsupported(resource, 'The Canvas assessment has multiple native question payloads.');
  }
  const primary = native[0] ??
    [resource.href, resource.file, ...resource.fileRefs].find(isAssessmentFile);
  if (!primary) return unsupported(resource, 'The resource declares no assessment file.');
  const primaryPath = existingPath(zip, resource, primary);
  if (!primaryPath) {
    return {
      ok: false,
      warning: {
        code: 'IMSCC_RESOURCE_MISSING',
        message:
          `Assessment resource ${resource.identifier}: declared assessment file ${primary} is missing.`,
      },
    };
  }
  if (native.length) {
    const file = zip.file(primaryPath);
    if (!file) return unsupported(resource, `Declared native payload ${primaryPath} is missing.`);
    const document = parseXml(await file.async('string'), 'Canvas native assessment');
    if (
      localName(document.documentElement) !== 'questestinterop' ||
      !findAllDescendantsByLocalName(document.documentElement, 'item').length
    ) {
      return unsupported(
        resource,
        'The declared Canvas native payload contains no supported question document.',
      );
    }
  }
  const warnings: ImportWarning[] = [];
  const paths = new Set<string>([primaryPath]);
  for (const entry of closure) {
    for (const declared of new Set([entry.href, entry.file, ...entry.fileRefs].filter(Boolean))) {
      const path = existingPath(zip, entry, declared);
      if (path) paths.add(path);
      else {warnings.push({
          code: 'IMSCC_RESOURCE_MISSING',
          message: `Declared resource file ${declared} is missing.`,
        });}
    }
  }
  if (
    closure.some((entry) => entry.fileRefs.some((path) => path.endsWith('/assessment_meta.xml')))
  ) {
    warnings.push({
      code: 'CANVAS_ASSESSMENT_SETTINGS_REVIEW',
      message:
        'Canvas quiz settings are preserved in the original package. Review timing, attempts and feedback-release settings before delivery.',
    });
  }
  return { ok: true, primaryPath, paths: [...paths], warnings };
}

/** Assessment payload extensions emitted by supported cartridge producers. */
export function isAssessmentFile(path: string): boolean {
  return /\.(xml|dat)(\.qti)?$/i.test(path);
}

/** Canvas's declared richer rendition, never an alternate selected after a parse failure. */
export function isCanvasNativePath(path: string): boolean {
  return /^non_cc_assessments\/[^/]+\.xml(?:\.qti)?$/i.test(path);
}

function existingPath(zip: ZipArchive, resource: ManifestResource, path: string): string | null {
  if (zip.file(path)) return path;
  const based = resource.baseurl ? normalizePath(`${resource.baseurl}/${path}`) : '';
  return based && zip.file(based) ? based : null;
}

function unsupported(resource: ManifestResource, detail: string): ResourceSelection {
  return {
    ok: false,
    warning: {
      code: 'IMSCC_RESOURCE_UNSUPPORTED',
      message: `Assessment resource ${resource.identifier}: ${detail}`,
    },
  };
}
