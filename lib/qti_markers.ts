import { xmlEscape } from './xml.ts';

export type QtiMarkerMatch = {
  id: string;
  match: string;
  attrsBefore: string;
  attrsAfter: string;
  innerHtml: string;
};

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markerGlobalRegex(attr: string): RegExp {
  const escapedAttr = escapeRegexLiteral(attr);
  return new RegExp(
    `<span\\b([^>]*)\\b${escapedAttr}="([^"]+)"([^>]*)>([\\s\\S]*?)<\\/span>`,
    'gi',
  );
}

function markerRegexForId(attr: string, id: string): RegExp {
  const escapedAttr = escapeRegexLiteral(attr);
  const escapedId = escapeRegexLiteral(id);
  return new RegExp(
    `<span\\b([^>]*)\\b${escapedAttr}="${escapedId}"([^>]*)>([\\s\\S]*?)<\\/span>`,
    'i',
  );
}

export function createMarkerHtml(opts: {
  attr: string;
  id: string;
  label: string;
  className?: string;
  contentEditable?: boolean;
}): string {
  const classes = (opts.className ?? '').trim();
  const contentEditable = opts.contentEditable === false ? ' contenteditable="false"' : '';
  const classAttr = classes ? ` class="${xmlEscape(classes)}"` : '';
  const label = opts.label?.trim() || opts.id;
  return `<span${classAttr} ${opts.attr}="${xmlEscape(opts.id)}"${contentEditable}>${
    xmlEscape(label)
  }</span>`;
}

export function listMarkerIds(html: string, attr: string): string[] {
  if (!html) return [];
  const ids: string[] = [];
  const regex = markerGlobalRegex(attr);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    ids.push(match[2]);
  }
  return ids;
}

export function replaceAllMarkers(
  html: string,
  attr: string,
  replacer: (info: QtiMarkerMatch) => string,
): { html: string; ids: string[] } {
  if (!html) return { html, ids: [] };
  const ids: string[] = [];
  const regex = markerGlobalRegex(attr);
  const output = html.replace(regex, (match, attrsBefore, id, attrsAfter, innerHtml) => {
    ids.push(id);
    return replacer({ id, match, attrsBefore, attrsAfter, innerHtml });
  });
  return { html: output, ids };
}

export function replaceMarkerById(
  html: string,
  attr: string,
  id: string,
  replacementHtml: string,
): { html: string; replaced: boolean } {
  if (!html) return { html, replaced: false };
  const regex = markerRegexForId(attr, id);
  let replaced = false;
  const next = html.replace(regex, () => {
    replaced = true;
    return replacementHtml;
  });
  return { html: next, replaced };
}

export function removeMarkerById(html: string, attr: string, id: string): string {
  const { html: next } = replaceMarkerById(html, attr, id, '');
  return next;
}
