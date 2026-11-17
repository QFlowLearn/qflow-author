import { normalizePackagePath } from '@longsightgroup/qti3-core';
import { ASSET_ATTR_REGEX } from '../../asset_refs.ts';
import { sanitizeBodyHtml, sanitizeInlineHtml } from '../../sanitize.ts';
import { xmlEscape } from '../../xml.ts';
import { baseDir } from '../package_paths.ts';
import type { ImportWarning } from '../types.ts';
import { attr, findChildByLocalName } from '../xml_dom.ts';

export type BlackboardContentContext = {
  readonly sourcePath: string;
  readonly assetPaths: ReadonlySet<string>;
  readonly warnings: ImportWarning[];
};
/** Honor declared HTML and resolve package media relative to its original POOL document. */
export function blackboardContentHtml(
  container: Element | null,
  context: BlackboardContentContext,
  inline = false,
): string {
  const raw = findChildByLocalName(container, 'TEXT')?.textContent?.trim() ?? '';
  const flags = findChildByLocalName(container, 'FLAGS');
  const flag = attr(findChildByLocalName(flags, 'ISHTML'), 'value');
  const html = flag === 'true' || flag === '1' ? raw : xmlEscape(raw);
  const clean = inline ? sanitizeInlineHtml(html) : sanitizeBodyHtml(`<div>${html}</div>`);
  return clean.replace(ASSET_ATTR_REGEX, (match, attribute, quote, reference: string) => {
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith('//') ||
      reference.startsWith('#')
    ) return match;
    const suffixIndex = reference.search(/[?#]/);
    const rawPath = suffixIndex < 0 ? reference : reference.slice(0, suffixIndex);
    const suffix = suffixIndex < 0 ? '' : reference.slice(suffixIndex);
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      decoded = '';
    }
    const base = baseDir(context.sourcePath);
    const candidate = base ? `${base}/${decoded}` : decoded;
    const path =
      !decoded || decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')
        ? undefined
        : normalizePackagePath(candidate, 'Blackboard content media', []);
    if (!path || !context.assetPaths.has(path)) {
      context.warnings.push({
        code: 'LMS_MEDIA_REVIEW',
        message:
          `Source media ${reference} could not be resolved relative to ${context.sourcePath}. Restore the original package file before acceptance.`,
      });
      return match;
    }
    return `${attribute}=${quote}${
      path.split('/').map(encodeURIComponent).join('/')
    }${suffix}${quote}`;
  });
}
