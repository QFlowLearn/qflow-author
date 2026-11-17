import { qti3PredefinedCatalogSupports } from '@longsightgroup/qti3-pnp';
import {
  type QtiAssessmentItem,
  type QtiCatalogCard,
  type QtiCatalogCardEntry,
  type QtiCatalogHtmlContent,
  type QtiContentNode,
} from '@longsightgroup/qti3-core';
import { sanitizeBodyHtml } from './sanitize.ts';
import { xmlEscape } from './xml.ts';
import type {
  CatalogCardDraft,
  CatalogCardEntryDraft,
  CatalogDraft,
  CatalogFileDraft,
  CatalogSupportDraft,
  QtiExtensionAttributes,
  StylesheetDraft,
} from './types/draft.ts';

export const PREDEFINED_CATALOG_SUPPORTS = qti3PredefinedCatalogSupports;
const predefinedSupportSet = new Set<string>(PREDEFINED_CATALOG_SUPPORTS);
const identifierPattern = /^[A-Za-z_][A-Za-z0-9._-]*$/;

/** Closed diagnostic vocabulary emitted by QTI catalog and stylesheet validation. */
export type CatalogValidationIssueCode =
  | 'CATALOG_CARD_CONTENT_CONFLICT'
  | 'CATALOG_CARD_REQUIRED'
  | 'CATALOG_CONTENT_CHOICE'
  | 'CATALOG_CONTENT_REQUIRED'
  | 'CATALOG_DEFAULT_CONFLICT'
  | 'CATALOG_FILE_REQUIRED'
  | 'CATALOG_FILE_UNSAFE'
  | 'CATALOG_ID_DUPLICATE'
  | 'CATALOG_ID_INVALID'
  | 'CATALOG_REFERENCE_MISSING'
  | 'CATALOG_SUPPORT_DUPLICATE'
  | 'CATALOG_SUPPORT_INVALID'
  | 'CATALOG_SUPPORT_PATH_INVALID'
  | 'CATALOG_SUPPORT_REQUIRED'
  | 'CATALOG_UNUSED'
  | 'KEYWORD_TRANSLATION_LANGUAGE_REQUIRED'
  | 'LANGUAGE_TAG_INVALID'
  | 'STYLESHEET_HREF_REQUIRED'
  | 'STYLESHEET_REFERENCE_UNSAFE';

/** One catalog or stylesheet validation finding with a stable policy code. */
export type CatalogValidationIssue = {
  readonly severity: 'error' | 'warning';
  readonly code: CatalogValidationIssueCode;
  readonly message: string;
  readonly path: string;
};

export class CatalogMetadataValidationError extends Error {
  constructor(public readonly issues: readonly CatalogValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'CatalogMetadataValidationError';
  }
}

export class UnsupportedCatalogContentError extends Error {
  constructor(public readonly nodeName: string) {
    super(`Catalog HTML contains unsupported QTI element "${nodeName}".`);
    this.name = 'UnsupportedCatalogContentError';
  }
}

export function isValidLanguageTag(value: string): boolean {
  const language = value.trim();
  if (!language) return false;
  try {
    new Intl.Locale(language);
    return true;
  } catch {
    return false;
  }
}

export function makeCatalogSupport(value: string): CatalogSupportDraft {
  const normalized = value.trim();
  return predefinedSupportSet.has(normalized)
    ? { kind: 'predefined', value: normalized }
    : { kind: 'custom', value: normalized };
}

export function validateCatalogMetadata(
  catalogs: readonly CatalogDraft[] | undefined,
  stylesheets: readonly StylesheetDraft[] | undefined = [],
): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  const catalogIds = new Set<string>();

  for (const [catalogIndex, catalog] of (catalogs ?? []).entries()) {
    const catalogPath = `catalogs[${catalogIndex}]`;
    const id = catalog.id.trim();
    if (!identifierPattern.test(id)) {
      issues.push(
        error(
          'CATALOG_ID_INVALID',
          `${catalogPath}.id`,
          'Catalog ID must be a valid QTI identifier.',
        ),
      );
    } else if (catalogIds.has(id)) {
      issues.push(
        error('CATALOG_ID_DUPLICATE', `${catalogPath}.id`, `Catalog ID "${id}" is duplicated.`),
      );
    }
    catalogIds.add(id);
    if (catalog.cards.length === 0) {
      issues.push(
        error(
          'CATALOG_CARD_REQUIRED',
          `${catalogPath}.cards`,
          `Catalog "${id || catalogIndex + 1}" needs at least one support card.`,
        ),
      );
    }

    const cardSupports = new Set<string>();
    for (const [cardIndex, card] of catalog.cards.entries()) {
      const cardPath = `${catalogPath}.cards[${cardIndex}]`;
      const support = card.support.value.trim();
      if (!support) {
        issues.push(
          error('CATALOG_SUPPORT_REQUIRED', `${cardPath}.support`, 'Catalog support is required.'),
        );
      } else if (card.support.kind === 'predefined' && !predefinedSupportSet.has(support)) {
        issues.push(
          error(
            'CATALOG_SUPPORT_INVALID',
            `${cardPath}.support`,
            `"${support}" is not a predefined QTI catalog support.`,
          ),
        );
      } else if (card.support.kind === 'custom' && predefinedSupportSet.has(support)) {
        issues.push(
          error(
            'CATALOG_SUPPORT_PATH_INVALID',
            `${cardPath}.support`,
            `Use the predefined support path for "${support}".`,
          ),
        );
      }
      if (cardSupports.has(support)) {
        issues.push(
          error(
            'CATALOG_SUPPORT_DUPLICATE',
            `${cardPath}.support`,
            `Catalog "${id}" has more than one card for support "${support}".`,
          ),
        );
      }
      cardSupports.add(support);
      validateLanguage(card.language, `${cardPath}.language`, issues);
      validateContentFiles(card, cardPath, issues, (card.entries?.length ?? 0) > 0);
      if ((card.entries?.length ?? 0) > 0 && (card.contentHtml?.trim() || card.files?.length)) {
        issues.push(
          error(
            'CATALOG_CARD_CONTENT_CONFLICT',
            cardPath,
            'A catalog card must use direct content or entries, not both.',
          ),
        );
      }

      let defaultCount = 0;
      for (const [entryIndex, entry] of (card.entries ?? []).entries()) {
        const entryPath = `${cardPath}.entries[${entryIndex}]`;
        validateLanguage(entry.language, `${entryPath}.language`, issues);
        validateContentFiles(
          entry,
          entryPath,
          issues,
          false,
          support === 'keyword-translation',
        );
        if (entry.default) defaultCount += 1;
        if (support === 'keyword-translation' && !entry.language?.trim()) {
          issues.push(
            error(
              'KEYWORD_TRANSLATION_LANGUAGE_REQUIRED',
              `${entryPath}.language`,
              'Each keyword translation needs a language.',
            ),
          );
        }
      }
      if (defaultCount > 1) {
        issues.push(
          error(
            'CATALOG_DEFAULT_CONFLICT',
            `${cardPath}.entries`,
            `Support "${support}" has more than one default entry.`,
          ),
        );
      }
    }
  }

  for (const [index, stylesheet] of (stylesheets ?? []).entries()) {
    const path = `stylesheets[${index}].href`;
    const href = stylesheet.href.trim();
    if (!href) issues.push(error('STYLESHEET_HREF_REQUIRED', path, 'Stylesheet href is required.'));
    else if (isUnsafeResourceReference(href)) {
      issues.push(
        error(
          'STYLESHEET_REFERENCE_UNSAFE',
          path,
          `Stylesheet "${href}" uses an unsafe or external reference.`,
        ),
      );
    }
  }
  return issues;
}

export function validateCatalogReferences(
  catalogs: readonly CatalogDraft[] | undefined,
  referencedIds: ReadonlySet<string>,
): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  const ids = new Set((catalogs ?? []).map((catalog) => catalog.id.trim()).filter(Boolean));
  for (const id of referencedIds) {
    if (!ids.has(id)) {
      issues.push(
        error(
          'CATALOG_REFERENCE_MISSING',
          'content',
          `Content references missing catalog "${id}".`,
        ),
      );
    }
  }
  for (const id of ids) {
    if (!referencedIds.has(id)) {
      issues.push({
        severity: 'warning',
        code: 'CATALOG_UNUSED',
        path: 'catalogs',
        message: `Catalog "${id}" is not referenced by item content.`,
      });
    }
  }
  return issues;
}

export function buildCatalogInfoXml(catalogs: readonly CatalogDraft[] | undefined): string {
  if (!(catalogs?.length)) return '';
  assertValid(catalogs);
  const xml = catalogs.map((catalog) => {
    const cards = catalog.cards.map(buildCardXml).join('\n');
    return `  <qti-catalog${
      attributesXml({ id: catalog.id.trim() }, catalog.attributes, ['id'])
    }>\n${cards}\n  </qti-catalog>`;
  }).join('\n');
  return `<qti-catalog-info>\n${xml}\n</qti-catalog-info>`;
}

export function buildStylesheetXml(stylesheets: readonly StylesheetDraft[] | undefined): string {
  return (stylesheets ?? []).map((stylesheet) => {
    const known: Record<string, string | undefined> = {
      href: stylesheet.href.trim(),
      type: stylesheet.type?.trim(),
      media: stylesheet.media?.trim(),
      title: stylesheet.title?.trim(),
    };
    return `  <qti-stylesheet${
      attributesXml(known, stylesheet.attributes, ['href', 'type', 'media', 'title'])
    }/>`;
  }).join('\n');
}

export function injectItemMetadataIntoXml(
  itemXml: string,
  catalogs: readonly CatalogDraft[] | undefined,
  stylesheets: readonly StylesheetDraft[] | undefined,
): string {
  let xml = itemXml
    .replace(/\s*<qti-catalog-info\b[\s\S]*?<\/qti-catalog-info>\s*/gi, '\n')
    .replace(/\s*<qti-stylesheet\b[^>]*\/?\s*>\s*/gi, '\n');
  const issues = [
    ...validateCatalogMetadata(catalogs, stylesheets),
    ...validateCatalogReferences(catalogs, collectCatalogReferenceIds(xml)),
  ].filter((issue) => issue.severity === 'error');
  if (issues.length) throw new CatalogMetadataValidationError(issues);
  const stylesheetXml = buildStylesheetXml(stylesheets);
  if (stylesheetXml) {
    const indented = stylesheetXml.replaceAll('\n', '\n  ');
    xml = xml.replace(/(\s*<qti-item-body\b)/i, `\n  ${indented}\n$1`);
  }
  const catalogXml = buildCatalogInfoXml(catalogs);
  if (!catalogXml) return xml;
  const indentedCatalog = catalogXml.replaceAll('\n', '\n  ');
  if (/<qti-response-processing\b/i.test(xml)) {
    return xml.replace(/(\s*<qti-response-processing\b)/i, `\n  ${indentedCatalog}\n$1`);
  }
  return xml.replace(
    /<\/qti-assessment-item>\s*$/i,
    `\n  ${indentedCatalog}\n</qti-assessment-item>`,
  );
}

export function collectCatalogReferenceIds(html: string): Set<string> {
  const ids = new Set<string>();
  const pattern = /\bdata-catalog-idref\s*=\s*("([^"]*)"|'([^']*)')/gi;
  for (const match of html.matchAll(pattern)) {
    const id = (match[2] ?? match[3] ?? '').trim();
    if (id) ids.add(id);
  }
  return ids;
}

function buildCardXml(card: CatalogCardDraft): string {
  const known = { support: card.support.value.trim(), 'xml:lang': card.language?.trim() };
  const direct = buildContentXml(card.contentHtml, card.files);
  const entries = (card.entries ?? []).map((entry) => buildEntryXml(entry, card.support.value))
    .join(
      '\n',
    );
  const content = [direct, entries].filter(Boolean).join('\n');
  return `    <qti-card${
    attributesXml(known, card.attributes, ['support', 'xml:lang', 'lang'])
  }>\n${content}\n    </qti-card>`;
}

function buildEntryXml(entry: CatalogCardEntryDraft, support: string): string {
  const known = {
    'xml:lang': entry.language?.trim(),
    default: entry.default ? 'true' : undefined,
  };
  const content = buildContentXml(
    entry.contentHtml,
    entry.files,
    support === 'keyword-translation',
  );
  return `      <qti-card-entry${
    attributesXml(known, entry.attributes, ['xml:lang', 'lang', 'default'])
  }>\n${content}\n      </qti-card-entry>`;
}

function buildContentXml(
  contentHtml: string | undefined,
  files: readonly CatalogFileDraft[] | undefined,
  embedFilesAsAudio = false,
): string {
  const parts: string[] = [];
  const htmlParts: string[] = [];
  if (contentHtml?.trim()) {
    const sanitizedContent = sanitizeBodyHtml(contentHtml.trim()) || '<p></p>';
    htmlParts.push(sanitizedContent);
  }
  if (embedFilesAsAudio && files?.length) {
    const sources = files.map((file) =>
      `          <source${
        attributesXml(
          { src: file.href.trim(), type: file.mimeType?.trim() },
          file.attributes,
          ['src', 'type', 'mime-type'],
        )
      }/>`
    ).join('\n');
    htmlParts.push(`<audio controls="controls">\n${sources}\n        </audio>`);
  }
  if (htmlParts.length) {
    parts.push(`        <qti-html-content>${htmlParts.join('')}</qti-html-content>`);
  }
  for (const file of embedFilesAsAudio ? [] : files ?? []) {
    parts.push(
      `        <qti-file-href${
        attributesXml({ 'mime-type': file.mimeType?.trim() }, file.attributes, ['mime-type'])
      }>${xmlEscape(file.href.trim())}</qti-file-href>`,
    );
  }
  return parts.join('\n');
}

function validateContentFiles(
  content: { contentHtml?: string; files?: CatalogFileDraft[] },
  path: string,
  issues: CatalogValidationIssue[],
  contentProvidedByEntries = false,
  allowContentWithFiles = false,
): void {
  if (!contentProvidedByEntries && !content.contentHtml?.trim() && !(content.files?.length)) {
    issues.push(
      error(
        'CATALOG_CONTENT_REQUIRED',
        path,
        'Catalog content needs HTML or at least one file reference.',
      ),
    );
  }
  if (!allowContentWithFiles && content.contentHtml?.trim() && content.files?.length) {
    issues.push(
      error(
        'CATALOG_CONTENT_CHOICE',
        path,
        'Catalog content must use HTML or file references, not both.',
      ),
    );
  }
  for (const [index, file] of (content.files ?? []).entries()) {
    const href = file.href.trim();
    if (!href) {
      issues.push(
        error(
          'CATALOG_FILE_REQUIRED',
          `${path}.files[${index}].href`,
          'Catalog file href is required.',
        ),
      );
    } else if (isUnsafeResourceReference(href)) {
      issues.push(
        error(
          'CATALOG_FILE_UNSAFE',
          `${path}.files[${index}].href`,
          `Catalog file "${href}" must be a package-local or uploaded resource.`,
        ),
      );
    }
  }
}

function validateLanguage(
  value: string | undefined,
  path: string,
  issues: CatalogValidationIssue[],
): void {
  if (value?.trim() && !isValidLanguageTag(value)) {
    issues.push(
      error('LANGUAGE_TAG_INVALID', path, `"${value}" is not a valid BCP 47 language tag.`),
    );
  }
}

function isUnsafeResourceReference(href: string): boolean {
  const value = href.trim();
  return !value || value.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.split('/').includes('..');
}

function assertValid(catalogs: readonly CatalogDraft[]): void {
  const issues = validateCatalogMetadata(catalogs).filter((issue) => issue.severity === 'error');
  if (issues.length) throw new CatalogMetadataValidationError(issues);
}

function attributesXml(
  known: Record<string, string | undefined>,
  extensions: QtiExtensionAttributes | undefined,
  reserved: readonly string[],
): string {
  const values = new Map<string, string>();
  for (const [name, value] of Object.entries(extensions ?? {})) {
    if (!reserved.includes(name) && !name.toLowerCase().startsWith('on')) values.set(name, value);
  }
  for (const [name, value] of Object.entries(known)) {
    if (value) values.set(name, value);
  }
  return [...values.entries()].map(([name, value]) => ` ${name}="${xmlEscape(value)}"`).join('');
}

function error(
  code: Exclude<CatalogValidationIssueCode, 'CATALOG_UNUSED'>,
  path: string,
  message: string,
): CatalogValidationIssue {
  return { severity: 'error', code, path, message };
}

/** Projects parsed QTI catalog metadata into canonical authoring drafts. */
export function catalogsFromQtiItem(item: QtiAssessmentItem): CatalogDraft[] {
  return (item.catalogInfo?.catalogs ?? []).map((catalog) => ({
    id: catalog.id,
    attributes: { ...catalog.attributes },
    cards: catalog.cards.map(cardFromQti),
  }));
}

/** Projects parsed QTI stylesheet metadata into canonical authoring drafts. */
export function stylesheetsFromQtiItem(item: QtiAssessmentItem): StylesheetDraft[] {
  return item.stylesheets.map((stylesheet) => ({
    href: stylesheet.href,
    type: stylesheet.type,
    media: stylesheet.media,
    title: stylesheet.title,
    attributes: { ...stylesheet.attributes },
  }));
}

function cardFromQti(card: QtiCatalogCard): CatalogCardDraft {
  return {
    support: makeCatalogSupport(card.support),
    language: card.language,
    contentHtml: htmlFromQti(card.htmlContent),
    files: filesFromQti(card.fileHrefs),
    entries: card.entries.map((entry) => entryFromQti(entry, card.support)),
    attributes: { ...card.attributes },
  };
}

function entryFromQti(entry: QtiCatalogCardEntry, support: string): CatalogCardEntryDraft {
  const files = filesFromQti(entry.fileHrefs);
  const contentHtml = htmlFromQti(
    entry.htmlContent,
    support === 'keyword-translation' ? files : undefined,
  );
  return {
    language: entry.language,
    default: entry.default,
    contentHtml,
    files,
    attributes: { ...entry.attributes },
  };
}

function filesFromQti(
  files: readonly { href: string; mimeType?: string; attributes: Record<string, string> }[],
): CatalogFileDraft[] {
  return files.map((file) => ({
    href: file.href,
    mimeType: file.mimeType,
    attributes: { ...file.attributes },
  }));
}

function htmlFromQti(
  content: QtiCatalogHtmlContent | undefined,
  audioFiles?: CatalogFileDraft[],
): string | undefined {
  if (!content) return undefined;
  return content.children.map((node) => serializeContentNode(node, audioFiles)).join('') ||
    undefined;
}

function serializeContentNode(node: QtiContentNode, audioFiles?: CatalogFileDraft[]): string {
  switch (node.kind) {
    case 'text':
      return escapeText(node.text);
    case 'element':
      if (node.qtiName.startsWith('qti-')) {
        throw new UnsupportedCatalogContentError(node.qtiName);
      }
      if (audioFiles && node.qtiName === 'audio') {
        collectAudioFiles(node, audioFiles);
        return '';
      }
      return elementXml(node.qtiName, node.attributes, node.children, audioFiles);
    case 'printedVariable':
      throw new UnsupportedCatalogContentError('qti-printed-variable');
    case 'feedback':
      throw new UnsupportedCatalogContentError(
        node.feedbackType === 'block' ? 'qti-feedback-block' : 'qti-feedback-inline',
      );
    case 'interaction':
      throw new UnsupportedCatalogContentError(node.qtiName);
  }
}

function elementXml(
  name: string,
  attributes: Record<string, string>,
  children: readonly QtiContentNode[],
  audioFiles?: CatalogFileDraft[],
): string {
  const attributesXml = Object.entries(attributes)
    .map(([attributeName, value]) => ` ${attributeName}="${escapeAttribute(value)}"`)
    .join('');
  const childrenXml = children.map((node) => serializeContentNode(node, audioFiles)).join('');
  return `<${name}${attributesXml}>${childrenXml}</${name}>`;
}

function collectAudioFiles(node: QtiContentNode, files: CatalogFileDraft[]): void {
  if (node.kind !== 'element') return;
  if (node.qtiName === 'source') {
    const href = node.attributes.src?.trim();
    if (href) {
      files.push({
        href,
        mimeType: node.attributes.type?.trim() || undefined,
        attributes: { ...node.attributes },
      });
    }
  }
  for (const child of node.children) collectAudioFiles(child, files);
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}
