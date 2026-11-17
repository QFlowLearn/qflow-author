import { normalizePackagePath } from '@longsightgroup/qti3-core';
import { ASSET_ATTR_REGEX } from '../../asset_refs.ts';
import type { ZipArchive } from '../../zip_archive.ts';
import { baseDir } from '../package_paths.ts';
import type { ImportWarning } from '../types.ts';
import { findAllDescendantsByLocalName, parseXmlStrict, serializer } from '../xml_dom.ts';
import type { ManifestResource } from './imscc_resources.ts';

type ResourceFiles =
  | { readonly ok: true; readonly files: Record<string, Uint8Array> }
  | { readonly ok: false; readonly warning: ImportWarning };

/** Resolve Canvas file-base URLs against declared webcontent, preserving source files in the archive. */
export async function prepareCanvasMedia(
  zip: ZipArchive,
  resources: readonly ManifestResource[],
  sourcePath: string,
  existingPaths: readonly string[],
): Promise<ResourceFiles> {
  const files: Record<string, Uint8Array> = {};
  for (const path of existingPaths) {
    const file = zip.file(path);
    if (file) files[path] = await file.async('uint8array');
  }
  const declaredMedia = new Set(
    resources.filter((resource) => resource.type.toLowerCase() === 'webcontent')
      .flatMap((resource) => [resource.href, resource.file, ...resource.fileRefs]).filter(Boolean),
  );
  const tokenTargets = new Map<string, Set<string>>();
  for (const path of declaredMedia) {
    // Canvas's file-base token names files inside web_resources, not an alternate archive-root URL.
    // Quiz-only assessment-owned files are declared at the archive root and retain that path.
    const alias = path.startsWith('web_resources/') ? path.slice('web_resources/'.length) : path;
    const targets = tokenTargets.get(alias) ?? new Set<string>();
    targets.add(path);
    tokenTargets.set(alias, targets);
  }
  const source = files[sourcePath];
  if (!source) {
    return unavailable('The declared question file is missing.', 'IMSCC_RESOURCE_MISSING');
  }
  const document = parseXmlStrict(new TextDecoder().decode(source), 'Canvas media references');
  const referencedMedia = new Set<string>();
  let problem: string | undefined;
  const rewrite = (reference: string): string => {
    const suffixIndex = reference.search(/[?#]/);
    const rawPath = suffixIndex < 0 ? reference : reference.slice(0, suffixIndex);
    const suffix = suffixIndex < 0 ? '' : reference.slice(suffixIndex);
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      if (rawPath.includes('IMS-CC-FILEBASE')) problem = 'A Canvas media URL has invalid encoding.';
      return reference;
    }
    const token = '$IMS-CC-FILEBASE$/';
    const tokenized = decoded.startsWith(token);
    if (
      !tokenized &&
      (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('//') || decoded.startsWith('#'))
    ) return reference;
    const base = baseDir(sourcePath);
    const candidate = tokenized
      ? decoded.slice(token.length)
      : base
      ? `${base}/${decoded}`
      : decoded;
    const normalized = candidate.includes('\\') || candidate.includes('\0')
      ? undefined
      : normalizePackagePath(candidate, 'Canvas media URL', []);
    const targets = normalized && tokenized ? tokenTargets.get(normalized) : undefined;
    const path = tokenized ? targets?.size === 1 ? [...targets][0] : undefined : normalized;
    if (!path || (tokenized && !declaredMedia.has(path))) {
      if (tokenized) {
        problem = 'A Canvas media URL escapes the package or names an undeclared file.';
      }
      return reference;
    }
    if (!declaredMedia.has(path)) return reference;
    referencedMedia.add(path);
    if (!tokenized) return reference;
    const prefix = baseDir(sourcePath).split('/').filter(Boolean).map(() => '..');
    return [...prefix, ...path.split('/').map(encodeURIComponent)].join('/') + suffix;
  };
  for (
    const element of [
      document.documentElement,
      ...Array.from(document.documentElement.getElementsByTagName('*')),
    ]
  ) {
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes[index];
      if (/^(src|href|uri|data|poster)$/i.test(attribute.localName || attribute.name)) {
        attribute.value = rewrite(attribute.value);
      }
    }
  }
  for (const material of findAllDescendantsByLocalName(document.documentElement, 'mattext')) {
    const html = material.textContent ?? '';
    const rewritten = html.replace(
      ASSET_ATTR_REGEX,
      (_match, attribute, quote, reference) => `${attribute}=${quote}${rewrite(reference)}${quote}`,
    );
    if (rewritten !== html) material.textContent = rewritten;
  }
  if (problem) return unavailable(problem);
  for (const path of referencedMedia) {
    const file = zip.file(path);
    if (!file) {
      return unavailable(
        `Declared Canvas media file ${path} is missing.`,
        'IMSCC_RESOURCE_MISSING',
      );
    }
    files[path] = await file.async('uint8array');
  }
  files[sourcePath] = new TextEncoder().encode(serializer.serializeToString(document));
  return { ok: true, files };
}

function unavailable(
  detail: string,
  code: 'IMSCC_RESOURCE_MISSING' | 'IMSCC_RESOURCE_UNSUPPORTED' = 'IMSCC_RESOURCE_UNSUPPORTED',
): ResourceFiles {
  return {
    ok: false,
    warning: {
      code,
      message: `${detail} Restore the referenced media in the source package and import it again.`,
    },
  };
}
