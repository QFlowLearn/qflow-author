import { DOMParser as XmldomParser, XMLSerializer } from '@xmldom/xmldom';
import { normalizeXmlForParsing } from '../xml.ts';

/**
 * Shared XML DOM helpers for package import adapters.
 * - `findChildByLocalName` / `findChildrenByLocalName`: direct children only.
 * - `findDescendantByLocalName` / `findAllDescendantsBy*`: depth-first descendant walks.
 */
const parser = new XmldomParser();
export const serializer = new XMLSerializer();

export function parseXml(xml: string, context: string): Document {
  const doc = parser.parseFromString(normalizeXmlForParsing(xml), 'text/xml');
  if (!doc || !doc.documentElement) throw new Error(`Failed to parse XML (${context})`);
  return doc;
}

/**
 * Parse XML without accepting repairs made by the DOM implementation.
 *
 * Some package formats intentionally use the tolerant parser above while recovering source.
 * Format adapters that require a well-formed document must opt into this strict boundary.
 */
export function parseXmlStrict(xml: string, context: string): Document {
  const diagnostics: string[] = [];
  const strictParser = new XmldomParser({
    errorHandler: (level, message) => {
      diagnostics.push(`${level}: ${String(message)}`);
    },
  });
  const doc = strictParser.parseFromString(normalizeXmlForParsing(xml), 'text/xml');
  if (!doc || !doc.documentElement || diagnostics.length > 0) {
    throw new Error(`Failed to parse well-formed XML (${context})`);
  }
  return doc;
}

export function serializeChildren(el: Element): string {
  let out = '';
  for (let i = 0; i < el.childNodes.length; i++) {
    out += serializer.serializeToString(el.childNodes[i] as Node);
  }
  return out;
}

export function toNumber(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Read one XML attribute using XML's case-sensitive name semantics. */
export function attr(el: Element | null | undefined, key: string): string | null {
  if (!el?.hasAttribute(key)) return null;
  return el.getAttribute(key);
}

/** Return the direct element children of an XML element or document. */
export function childElements(node: Element | Document): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes[i];
    if (child.nodeType === 1) out.push(child as Element);
  }
  return out;
}

/** Return an element's lowercase local name without a namespace prefix. */
export function localName(el: Element | null | undefined): string {
  return el?.localName?.toLowerCase() ?? '';
}

/** Find the first direct child with the requested local name. */
export function findChildByLocalName(
  root: Element | Document | null | undefined,
  tag: string,
): Element | null {
  if (!root) return null;
  const target = tag.toLowerCase();
  for (const child of childElements(root)) {
    if (localName(child) === target) return child;
  }
  return null;
}

/** Find every direct child with the requested local name. */
export function findChildrenByLocalName(
  root: Element | Document | null | undefined,
  tag: string,
): Element[] {
  if (!root) return [];
  const target = tag.toLowerCase();
  return childElements(root).filter((child) => localName(child) === target);
}

/** Find the first descendant with the requested local name. */
export function findDescendantByLocalName(
  root: Element | Document | null | undefined,
  tag: string,
): Element | null {
  if (!root) return null;
  const target = tag.toLowerCase();
  for (const child of childElements(root)) {
    if (localName(child) === target) return child;
    const nested = findDescendantByLocalName(child, target);
    if (nested) return nested;
  }
  return null;
}

/** Find every descendant with the requested local name. */
export function findAllDescendantsByLocalName(
  root: Element | Document | null | undefined,
  tag: string,
): Element[] {
  return findAllDescendantsByAnyLocalName(root, [tag]);
}

/** Find every descendant whose local name is in the requested set. */
export function findAllDescendantsByAnyLocalName(
  root: Element | Document | null | undefined,
  tags: readonly string[],
): Element[] {
  if (!root) return [];
  const tagSet = new Set(tags.map((tag) => tag.toLowerCase()));
  const matches: Element[] = [];
  const walk = (node: Element | Document) => {
    for (const child of childElements(node)) {
      if (tagSet.has(localName(child))) matches.push(child);
      if (child.childNodes.length) walk(child);
    }
  };
  walk(root);
  return matches;
}
