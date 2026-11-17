import { normalizePackagePath } from '@longsightgroup/qti3-core';
import { ASSET_ATTR_REGEX } from '../../asset_refs.ts';
import type { ImportWarning } from '../types.ts';
import { sanitizeBodyHtml, sanitizeInlineHtml } from '../../sanitize.ts';
import { xmlEscape } from '../../xml.ts';
import { attr, findAllDescendantsByLocalName, findDescendantByLocalName } from '../xml_dom.ts';
import type { ImportedAsset } from '../types.ts';

/** Moodle file references are local to their text field, not to the entire question. */
export type MoodleAssetContext = {
  readonly byOwner: Map<Element, { readonly scope: number; readonly paths: Map<string, string> }>;
  readonly warnings: ImportWarning[];
};

export function readMoodleQuestionTitle(questionElement: Element): string {
  return readMoodleTextContent(findDescendantByLocalName(questionElement, 'name')).trim();
}

export function readMoodleRawText(element: Element | null): string {
  if (!element) return '';
  const textElement = findDescendantByLocalName(element, 'text');
  const raw = (textElement?.textContent ?? element.textContent ?? '').trim();
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function readMoodleTextContent(element: Element | null): string {
  if (!element) return '';
  const textElement = findDescendantByLocalName(element, 'text');
  return (textElement?.textContent ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function readMoodleBodyHtml(
  element: Element | null,
  assetMap?: MoodleAssetContext,
): string {
  if (!element) return '';
  const html = sanitizeBodyHtml(readFormattedHtml(element, false, assetMap?.warnings));
  const rewritten = assetMap ? rewritePluginFiles(html, element, assetMap) : html;
  return rewritten || '<p></p>';
}

export function readMoodleInlineHtml(
  element: Element | null,
  assetMap?: MoodleAssetContext,
): string {
  if (!element) return '';
  const html = sanitizeInlineHtml(readFormattedHtml(element, true, assetMap?.warnings));
  const rewritten = assetMap ? rewritePluginFiles(html, element, assetMap) : html;
  return rewritten || '';
}

export function extractMoodleFiles(
  questionElement: Element,
  identifier: string,
  warnings: ImportWarning[],
): { readonly assets: ImportedAsset[]; readonly context: MoodleAssetContext } {
  const assets: ImportedAsset[] = [];
  const byOwner: MoodleAssetContext['byOwner'] = new Map();
  for (const file of findAllDescendantsByLocalName(questionElement, 'file')) {
    const owner = file.parentNode;
    if (!owner || owner.nodeType !== 1) continue;
    // SAFETY: the nodeType guard establishes the XML element that owns this file area.
    const element = owner as Element;
    let area = byOwner.get(element);
    if (!area) {
      area = { scope: byOwner.size + 1, paths: new Map() };
      byOwner.set(element, area);
    }
    const { paths, scope } = area;
    const name = attr(file, 'name')?.trim() ?? '';
    const prefix = (attr(file, 'path') ?? '').replace(/^\/+|\/+$/g, '');
    const candidate = prefix ? `${prefix}/${name}` : name;
    const relative = candidate.includes('\\') || candidate.includes('\0')
      ? undefined
      : normalizePackagePath(candidate, 'Moodle embedded file', []);
    if (!relative || !name || paths.has(relative) || attr(file, 'encoding') !== 'base64') {
      warnings.push({
        code: 'LMS_MEDIA_REVIEW',
        message:
          'An embedded file has an invalid or duplicate field-local name or unsupported encoding. Correct the original file and import it again.',
      });
      continue;
    }
    let data: Uint8Array;
    try {
      data = decodeBase64((file.textContent ?? '').replace(/\s+/g, ''));
    } catch {
      warnings.push({
        code: 'LMS_MEDIA_REVIEW',
        message:
          `Embedded file ${name} has invalid base64 data. Restore the source file and import it again.`,
      });
      continue;
    }
    const assetPath = `moodle/${identifier}/field-${scope}/${relative}`;
    paths.set(relative, assetPath);
    const mime = attr(file, 'mimetype') ?? inferMime(name);
    assets.push({ path: assetPath, name, data, ...(mime ? { mime } : {}) });
  }
  return { assets, context: { byOwner, warnings } };
}

export function normalizeMoodleCategoryTag(value: string): string {
  const trimmed = value.replace(/\$course\$\//gi, '').trim();
  return trimmed.split('/').filter(Boolean).pop() ?? trimmed;
}

export function moodleChoiceLabel(index: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return index < alphabet.length ? alphabet[index] : `C${index + 1}`;
}

export function uniqueMoodleIdentifier(base: string, seen: Set<string>): string {
  let identifier = base;
  let counter = 1;
  while (seen.has(identifier)) {
    counter += 1;
    identifier = `${base}_${counter}`;
  }
  seen.add(identifier);
  return identifier;
}

function readFormattedHtml(element: Element, inline: boolean, warnings?: ImportWarning[]): string {
  const format = (attr(element, 'format') ?? '').toLowerCase();
  const raw = (findDescendantByLocalName(element, 'text')?.textContent ?? '').trim();
  if (!raw) return '';
  if (format === '' || format === 'html') return raw;
  if (format !== 'plain_text') {
    warnings?.push({
      code: 'LMS_CONTENT_REVIEW',
      message:
        `Moodle ${format} formatting is retained as literal text. Reapply the source formatting before delivery.`,
    });
  }
  const literal = xmlEscape(raw).replace(/\r?\n/g, '<br/>');
  return inline ? literal : `<p>${literal}</p>`;
}

function rewritePluginFiles(html: string, owner: Element, context: MoodleAssetContext): string {
  return html.replace(ASSET_ATTR_REGEX, (match, attribute, quote, reference: string) => {
    const suffixIndex = reference.search(/[?#]/);
    const rawPath = suffixIndex < 0 ? reference : reference.slice(0, suffixIndex);
    const suffix = suffixIndex < 0 ? '' : reference.slice(suffixIndex);
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      decoded = rawPath;
    }
    if (!decoded.startsWith('@@PLUGINFILE@@/')) return match;
    const path = context.byOwner.get(owner)?.paths.get(decoded.slice('@@PLUGINFILE@@/'.length));
    if (!path) {
      context.warnings.push({
        code: 'LMS_MEDIA_REVIEW',
        message:
          `An embedded media reference in this text field could not be resolved: ${reference}. Restore its source file and import again.`,
      });
      return match;
    }
    return `${attribute}=${quote}${
      path.split('/').map(encodeURIComponent).join('/')
    }${suffix}${quote}`;
  });
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function inferMime(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return undefined;
}

/** Moodle exports shuffleanswers as element text rather than an XML attribute. */
export function readMoodleShuffle(question: Element): boolean {
  const value = readMoodleTextContent(findDescendantByLocalName(question, 'shuffleanswers'))
    .toLowerCase();
  return value === 'true' || value === '1';
}
