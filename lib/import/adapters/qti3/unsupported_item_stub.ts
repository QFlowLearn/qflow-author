import { sanitizeBodyHtml } from '../../../sanitize.ts';
import { normalizeQtiHtmlFragment } from './content_html.ts';
import type { ImportedItem, ImportWarning } from '../../types.ts';
import { normalizePath } from '../../package_paths.ts';
import {
  attr,
  findAllDescendantsByLocalName,
  findChildByLocalName,
  localName,
  parseXml,
  serializeChildren,
} from '../../xml_dom.ts';

export function buildUnsupportedItemStub(
  xml: string,
  href: string,
  reason: string,
): { item: Omit<ImportedItem, 'href' | 'xml'>; warning: ImportWarning } {
  const stem = normalizePath(href).split('/').pop()?.replace(/\.xml$/i, '') ||
    `item-${crypto.randomUUID()}`;
  let identifier = stem;
  let title = 'Imported Item';
  let responseIdentifier = 'RESPONSE';
  let customBaseType = 'string';
  let customCardinality: 'single' | 'multiple' | 'ordered' | 'record' = 'single';
  let bodyHtml = '<p>This item uses an unsupported interaction. Original QTI XML is preserved.</p>';

  try {
    const doc = parseXml(xml, `unsupported-item:${href}`);
    const root = doc.documentElement;
    if (root && localName(root) === 'qti-assessment-item') {
      identifier = (attr(root, 'identifier') ?? '').trim() || stem;
      title = (attr(root, 'title') ?? '').trim() || title;
      const body = findChildByLocalName(root, 'qti-item-body');
      if (body) {
        const sanitized = sanitizeBodyHtml(normalizeQtiHtmlFragment(serializeChildren(body)));
        if (sanitized) bodyHtml = sanitized;
      }
      const responseDecls = findAllDescendantsByLocalName(root, 'qti-response-declaration');
      const responseDecl = responseDecls.find((decl) =>
        (attr(decl, 'identifier') ?? '').toUpperCase() === 'RESPONSE'
      ) ?? responseDecls[0];
      if (responseDecl) {
        responseIdentifier = (attr(responseDecl, 'identifier') ?? '').trim() || responseIdentifier;
        customBaseType = (attr(responseDecl, 'base-type') ?? '').trim() || customBaseType;
        customCardinality = normalizeCustomCardinality(attr(responseDecl, 'cardinality'));
      }
    }
  } catch {
    // Keep fallback defaults when shell parse also fails.
  }

  const warning: ImportWarning = {
    code: 'UNSUPPORTED_ITEM_STUBBED',
    path: href,
    message: 'Imported item as a stub because the interaction type is not yet supported.',
    detail: reason,
  };

  return {
    item: {
      identifier,
      title,
      draft: {
        type: 'custom_interaction',
        title,
        promptHtml:
          '<p>Imported with unsupported interaction. This item is retained as a compatibility stub.</p>',
        bodyHtml,
        responseIdentifier,
        customBaseType,
        customCardinality,
        customClassName: 'qflowUnsupportedImport',
        customDefinition: 'urn:qflow:unsupported-import',
        customAttributes: [{ name: 'data-qflow-unsupported-import', value: 'true' }],
        customInteractionMarkup:
          '<div data-qflow-unsupported-import="true">Unsupported interaction placeholder</div>',
        tags: ['imported', 'unsupported-interaction'],
        importWarnings: [warning],
        preserveSourceXml: true,
      } as ImportedItem['draft'],
    },
    warning,
  };
}

function normalizeCustomCardinality(
  value: string | null | undefined,
): 'single' | 'multiple' | 'ordered' | 'record' {
  const normalized = (value ?? '').toLowerCase();
  if (normalized === 'multiple' || normalized === 'ordered' || normalized === 'record') {
    return normalized;
  }
  return 'single';
}
