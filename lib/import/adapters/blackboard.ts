import type { ImportedOrganizationGroup } from '../organization_groups.ts';
import { sanitizeBodyHtml } from '../../sanitize.ts';
import { createPlaceholderHtml } from '../../text_entry_placeholders.ts';
import type { UnlabeledImportDraft } from '../imported_item_qti.ts';
import type { QuestionTypeId } from '../../types/registry.ts';
import { normalizeQtiIdentifier } from '../../qti_identifiers.ts';
import type { ZipArchive } from '../../zip_archive.ts';
import { IMPORT_ADAPTER_DESCRIPTORS } from '../adapter_descriptors.ts';
import { withImportArchive } from '../archive_policy.ts';
import { buildImportedItem } from '../imported_item_qti.ts';
import {
  attr,
  childElements,
  findAllDescendantsByLocalName,
  findChildByLocalName,
  localName,
  parseXml,
} from '../xml_dom.ts';
import { type BlackboardContentContext, blackboardContentHtml } from './blackboard_content.ts';
import { parseManifestQti12Documents } from './blackboard_qti.ts';
import type {
  ImportAdapter,
  ImportedAsset,
  ImportedItem,
  ImportedPart,
  ImportedPlacement,
  ImportResult,
  ImportSource,
  ImportWarning,
  SniffResult,
} from '../types.ts';

const ZIP_MAGIC = [0x50, 0x4b];

const POOL_CLASS_MAP: Record<string, QuestionTypeId | 'skip'> = {
  QUESTION_MULTIPLEANSWER: 'multi_select',
  QUESTION_MULTIPLECHOICE: 'single_select',
  QUESTION_TRUEFALSE: 'single_select',
  QUESTION_ESSAY: 'extended_text',
  QUESTION_FILLINBLANK: 'text_entry',
  QUESTION_SHORTANSWER: 'text_entry',
  QUESTION_MATCH: 'match',
};

export const blackboardAdapter: ImportAdapter = {
  ...IMPORT_ADAPTER_DESCRIPTORS.blackboard,
  sniff: sniffBlackboard,
  parse: parseBlackboard,
};

async function sniffBlackboard(source: ImportSource): Promise<SniffResult> {
  if (isZip(source.bytes)) {
    try {
      return await withImportArchive(source.bytes, sniffBlackboardArchive);
    } catch (_err) {
      return { supported: false, confidence: 0, reason: 'invalid-zip' };
    }
  }

  const preview = new TextDecoder().decode(source.bytes.slice(0, 4096));
  if (looksLikePoolXml(preview)) {
    return { supported: true, confidence: 0.8, reason: 'pool-root' };
  }
  if (/assessment\/x-bb-/i.test(preview)) {
    return { supported: true, confidence: 0.6, reason: 'blackboard-manifest-text' };
  }
  return { supported: false, confidence: 0, reason: 'no-blackboard-markers' };
}

async function sniffBlackboardArchive(zip: ZipArchive): Promise<SniffResult> {
  const manifestFile = zip.file(/imsmanifest\.xml$/i)[0] ?? null;
  if (manifestFile) {
    const manifestXml = await manifestFile.async('string');
    if (/assessment\/x-bb-/i.test(manifestXml)) {
      return { supported: true, confidence: 0.9, reason: 'manifest-blackboard-resource' };
    }
  }

  if (await zipContainsPool(zip)) {
    return { supported: true, confidence: 0.75, reason: 'pool-xml-in-zip' };
  }
  return { supported: false, confidence: 0.1, reason: 'zip-no-blackboard-signals' };
}

async function parseBlackboard(source: ImportSource): Promise<ImportResult> {
  const warnings: ImportWarning[] = [];
  const assets: ImportedAsset[] = [];
  const allItems: ImportedItem[] = [];
  const placements: ImportedPlacement[] = [];
  const organizationGroups: ImportedOrganizationGroup[] = [];
  const seenIdentifiers = new Set<string>();

  if (isZip(source.bytes)) {
    const fromZip = await extractPoolDocumentsFromZip(source.bytes);
    if (!fromZip.poolDocs.length) {
      if (fromZip.qti12Docs.length) {
        return await parseManifestQti12Documents(fromZip.qti12Docs, fromZip.assets);
      }
      throw new Error('Blackboard package did not contain a POOL document.');
    }
    assets.push(...fromZip.assets);

    fromZip.poolDocs.forEach((poolDoc, index) => {
      const parsed = parsePoolDocument(poolDoc.xml, {
        fileLabel: poolDoc.path,
        assetPaths: new Set(fromZip.assets.map((asset) => asset.path)),
        seenIdentifiers,
        warnings,
        poolIndex: index,
      });
      if (parsed.group) organizationGroups.push(parsed.group);
      parsed.items.forEach((item) => {
        allItems.push(item);
        placements.push({ href: item.href });
      });
    });
  } else {
    const xml = decodeUtf8(source.bytes);
    const parsed = parsePoolDocument(xml, {
      fileLabel: source.filename ?? 'blackboard-pool',
      assetPaths: new Set(),
      seenIdentifiers,
      warnings,
      poolIndex: 0,
    });
    if (parsed.group) organizationGroups.push(parsed.group);
    parsed.items.forEach((item) => {
      allItems.push(item);
      placements.push({ href: item.href });
    });
  }

  if (!allItems.length) {
    throw new Error('No Blackboard questions could be imported.');
  }

  const parts: ImportedPart[] = [
    {
      id: 'part-1',
      title: 'Part 1',
      placements,
    },
  ];

  return {
    title: 'Imported Blackboard Pool',
    parts,
    organizationGroups,
    items: allItems,
    assets,
    warnings: warnings.length ? warnings : undefined,
  };
}

type ParsedPoolContext = {
  fileLabel: string;
  assetPaths: ReadonlySet<string>;
  seenIdentifiers: Set<string>;
  warnings: ImportWarning[];
  poolIndex: number;
};

function parsePoolDocument(xml: string, context: ParsedPoolContext): {
  items: ImportedItem[];
  group: ImportedOrganizationGroup | null;
} {
  const doc = parseXml(xml, context.fileLabel);
  const root = doc.documentElement;
  if (!root || localName(root) !== 'pool') {
    throw new Error(`Blackboard document ${context.fileLabel} is not a POOL export.`);
  }

  const questionList = findChildByLocalName(root, 'QUESTIONLIST');
  if (!questionList) {
    throw new Error(`Blackboard POOL ${context.fileLabel} is missing QUESTIONLIST.`);
  }

  const questionRefs = childElements(questionList)
    .filter((element) => localName(element) === 'question')
    .map((element) => ({
      id: attr(element, 'id') ?? '',
      klass: attr(element, 'class') ?? '',
    }))
    .filter((entry) => entry.id && entry.klass);

  const items: ImportedItem[] = [];
  questionRefs.forEach((ref, index) => {
    const qType = POOL_CLASS_MAP[ref.klass] ?? 'skip';
    if (qType === 'skip') {
      context.warnings.push({
        code: 'BLACKBOARD_UNSUPPORTED_TYPE',
        message: `Unsupported Blackboard question class: ${ref.klass}`,
        detail: `${context.fileLabel}:${ref.id}`,
      });
      return;
    }

    const questionEl = findQuestionElement(root, ref.klass, ref.id);
    if (!questionEl) {
      context.warnings.push({
        code: 'BLACKBOARD_MISSING_QUESTION',
        message: `Missing Blackboard question node for ${ref.id}.`,
        detail: `${context.fileLabel}:${ref.klass}`,
      });
      return;
    }

    const bodyText = readQuestionBody(questionEl);
    const title = bodyText || `Question ${context.poolIndex + 1}.${index + 1}`;
    const baseId = normalizeQtiIdentifier(title, `ITEM_${context.poolIndex + 1}_${index + 1}`);
    const identifier = uniqueIdentifier(baseId, context.seenIdentifiers);

    const questionWarnings: ImportWarning[] = [];
    const draft = buildUnlabeledImportDraftForQuestion(
      ref.klass,
      questionEl,
      title,
      { sourcePath: context.fileLabel, assetPaths: context.assetPaths, warnings: questionWarnings },
    );
    if (!draft) {
      context.warnings.push(...questionWarnings);
      return;
    }

    const item = buildImportedItem({
      sourceFormat: 'blackboard',
      draft,
      href: `${identifier}.xml`,
      identifier,
      title,
      sourceText: bodyText,
    });
    context.warnings.push(...questionWarnings.map((warning) => ({ ...warning, path: item.href })));
    items.push(item);
  });

  // Pool membership is source organization, not an assessment delivery part.
  // Unnamed pools carry no proposed category; never infer one from a resource filename.
  const title = attr(findChildByLocalName(root, 'TITLE'), 'value')?.trim();
  return {
    items,
    group: title && items.length
      ? {
        id: `blackboard-pool-${context.poolIndex + 1}`,
        title,
        hrefs: items.map((item) => item.href),
      }
      : null,
  };
}

function buildUnlabeledImportDraftForQuestion(
  klass: string,
  questionEl: Element,
  title: string,
  content: BlackboardContentContext,
): UnlabeledImportDraft | null {
  const { warnings } = content;
  const bodyHtml = blackboardContentHtml(findChildByLocalName(questionEl, 'BODY'), content);
  const answerEls = childElements(questionEl).filter((element) => localName(element) === 'answer');
  const sortedAnswerEls = answerEls.sort((a, b) => toPosition(a) - toPosition(b));

  if (klass === 'QUESTION_MULTIPLECHOICE' || klass === 'QUESTION_TRUEFALSE') {
    const parsed = parseChoiceAnswers(sortedAnswerEls, content);
    if (!parsed.choices.length) {
      warnings.push({
        code: 'BLACKBOARD_NO_CHOICES',
        message: `Question "${title}" has no choices.`,
      });
      return null;
    }
    const correctId = resolveCorrectChoiceIds(questionEl, parsed.answerIdToChoiceId)[0] ?? '';
    if (!correctId) {
      warnings.push({
        code: 'MISSING_CORRECT',
        message:
          'Source correct-answer references are missing or do not identify an available choice. Set the answer explicitly before acceptance.',
      });
    }
    return {
      type: 'single_select',
      title,
      bodyHtml,
      choices: parsed.choices,
      correctId,
      shuffle: false,
    };
  }

  if (klass === 'QUESTION_MULTIPLEANSWER') {
    const parsed = parseChoiceAnswers(sortedAnswerEls, content);
    if (!parsed.choices.length) {
      warnings.push({
        code: 'BLACKBOARD_NO_CHOICES',
        message: `Question "${title}" has no choices.`,
      });
      return null;
    }
    const correctIds = resolveCorrectChoiceIds(questionEl, parsed.answerIdToChoiceId);
    if (!correctIds.length) {
      warnings.push({
        code: 'MISSING_CORRECT',
        message:
          'Source correct-answer references are missing or do not identify available choices. Set the answers explicitly before acceptance.',
      });
    }
    return {
      type: 'multi_select',
      title,
      bodyHtml,
      choices: parsed.choices,
      correctIds,
      shuffle: false,
    };
  }

  if (klass === 'QUESTION_ESSAY') {
    return {
      type: 'extended_text',
      externalScored: 'human',
      title,
      bodyHtml,
      responseIdentifier: 'RESPONSE',
      responseBaseType: 'string',
      responseCardinality: 'single',
      format: 'plain',
      heightClass: 'qti-height-lines-6',
      counterType: 'none',
    };
  }

  if (klass === 'QUESTION_FILLINBLANK' || klass === 'QUESTION_SHORTANSWER') {
    const values = sortedAnswerEls
      .map((answer) => readText(answer, 'TEXT'))
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.length) {
      warnings.push({
        code: 'BLACKBOARD_NO_TEXT_ENTRY_ANSWERS',
        message: `Question "${title}" has no accepted fill-in answers.`,
      });
      return null;
    }

    const slotId = 'RESPONSE';
    return {
      type: 'text_entry',
      title,
      bodyHtml: appendPlaceholder(bodyHtml, createPlaceholderHtml({ id: slotId, label: 'Answer' })),
      textEntries: [
        {
          id: slotId,
          label: 'Answer',
          responseBaseType: 'string',
          answers: values.map((value) => ({
            id: crypto.randomUUID(),
            value,
            score: 1,
            caseSensitive: false,
          })),
        },
      ],
    };
  }

  if (klass === 'QUESTION_MATCH') {
    const sourceEls = sortedAnswerEls.filter((answer) =>
      (attr(answer, 'placement') ?? '').toLowerCase() !== 'right'
    );
    const targetEls = childElements(questionEl)
      .filter((element) => localName(element) === 'choice')
      .sort((a, b) => toPosition(a) - toPosition(b));

    const sourceByAnswerId = new Map<string, string>();
    const targetByChoiceId = new Map<string, string>();

    const sources = sourceEls.map((answer, index) => {
      const sourceId = `S${index + 1}`;
      const answerId = attr(answer, 'id') ?? sourceId;
      sourceByAnswerId.set(answerId, sourceId);
      return {
        id: sourceId,
        text: readText(answer, 'TEXT').replace(/<[^>]*>/g, '').trim() || sourceId,
        html: blackboardContentHtml(answer, content, true),
      };
    });

    const targets = targetEls.map((choice, index) => {
      const targetId = `T${index + 1}`;
      const choiceId = attr(choice, 'id') ?? targetId;
      targetByChoiceId.set(choiceId, targetId);
      return {
        id: targetId,
        text: readText(choice, 'TEXT').replace(/<[^>]*>/g, '').trim() || targetId,
        html: blackboardContentHtml(choice, content, true),
      };
    });

    const correctPairs = findCorrectAnswerElements(questionEl)
      .map((element) => ({
        sourceId: sourceByAnswerId.get(attr(element, 'answer_id') ?? ''),
        targetId: targetByChoiceId.get(attr(element, 'choice_id') ?? ''),
      }))
      .filter((entry): entry is { sourceId: string; targetId: string } =>
        Boolean(entry.sourceId && entry.targetId)
      );

    if (!sources.length || !targets.length || !correctPairs.length) {
      warnings.push({
        code: 'BLACKBOARD_MATCH_INCOMPLETE',
        message: `Question "${title}" has incomplete matching data.`,
      });
      return null;
    }

    return {
      type: 'match',
      title,
      bodyHtml,
      sources,
      targets,
      correctPairs,
    };
  }

  warnings.push({
    code: 'BLACKBOARD_UNSUPPORTED_TYPE',
    message: `Unsupported Blackboard question class: ${klass}`,
  });
  return null;
}

function parseChoiceAnswers(
  answers: Element[],
  context: BlackboardContentContext,
): {
  choices: Array<{ id: string; text: string; html: string }>;
  answerIdToChoiceId: Map<string, string>;
} {
  const answerIdToChoiceId = new Map<string, string>();
  const choices = answers.map((answer, index) => {
    const id = choiceLabel(index);
    const answerId = attr(answer, 'id') ?? id;
    answerIdToChoiceId.set(answerId, id);
    return {
      id,
      text: readText(answer, 'TEXT').replace(/<[^>]*>/g, '').trim() || id,
      html: blackboardContentHtml(answer, context, true),
    };
  });

  if (!choices.length) {
    context.warnings.push({
      code: 'BLACKBOARD_EMPTY_ANSWERS',
      message: 'Blackboard question contained no ANSWER entries.',
    });
  }

  return { choices, answerIdToChoiceId };
}

function resolveCorrectChoiceIds(
  questionEl: Element,
  answerIdToChoiceId: Map<string, string>,
): string[] {
  const correct = findCorrectAnswerElements(questionEl)
    .map((element) => attr(element, 'answer_id') ?? '')
    .map((answerId) => answerIdToChoiceId.get(answerId))
    .filter((choiceId): choiceId is string => Boolean(choiceId));
  return Array.from(new Set(correct));
}

function findCorrectAnswerElements(questionEl: Element): Element[] {
  const gradable = findChildByLocalName(questionEl, 'GRADABLE');
  if (!gradable) return [];
  return childElements(gradable).filter((element) => localName(element) === 'correctanswer');
}

function readQuestionBody(questionEl: Element): string {
  const body = findChildByLocalName(questionEl, 'BODY');
  if (!body) return '';
  return readText(body, 'TEXT').trim();
}

function appendPlaceholder(bodyHtml: string, placeholder: string): string {
  const clean = sanitizeBodyHtml(bodyHtml || '');
  if (!clean || clean === '<p></p>') return `<p>${placeholder}</p>`;
  return `${clean}\n<p>${placeholder}</p>`;
}

async function extractPoolDocumentsFromZip(
  bytes: Uint8Array,
): Promise<{
  poolDocs: Array<{ path: string; xml: string }>;
  qti12Docs: Array<{ path: string; xml: string }>;
  assets: ImportedAsset[];
}> {
  return await withImportArchive(bytes, extractPoolDocuments);
}

async function extractPoolDocuments(zip: ZipArchive): Promise<{
  poolDocs: Array<{ path: string; xml: string }>;
  qti12Docs: Array<{ path: string; xml: string }>;
  assets: ImportedAsset[];
}> {
  const candidatePaths = new Set<string>();
  const manifestFile = zip.file(/imsmanifest\.xml$/i)[0] ?? null;
  if (manifestFile) {
    const manifestXml = await manifestFile.async('string');
    const manifestDoc = parseXml(manifestXml, 'blackboard-manifest');
    const resourceEls = findAllDescendantsByLocalName(
      manifestDoc.documentElement ?? manifestDoc,
      'resource',
    );
    for (const resourceEl of resourceEls) {
      const type = (attr(resourceEl, 'type') ?? '').toLowerCase();
      if (!type.includes('x-bb-')) continue;
      const baseurl = normalizePath(
        attr(resourceEl, 'baseurl') || attr(resourceEl, 'xml:base') ||
          attrByLocalName(resourceEl, 'base') || '',
      );
      const directFile = normalizePath(
        attr(resourceEl, 'file') || attr(resourceEl, 'bb:file') ||
          attrByLocalName(resourceEl, 'file') || '',
      );
      const directHref = normalizePath(attr(resourceEl, 'href') ?? '');
      const childFiles = childElements(resourceEl)
        .filter((element) => localName(element) === 'file')
        .map((element) => normalizePath(attr(element, 'href') ?? ''));

      const resourcePaths = [directFile, directHref, ...childFiles].filter(Boolean);
      for (const resourcePath of resourcePaths) {
        candidatePaths.add(resourcePath);
        if (baseurl) candidatePaths.add(normalizePath(`${baseurl}/${resourcePath}`));
      }
    }
  }

  const poolDocs: Array<{ path: string; xml: string }> = [];
  const qti12Docs: Array<{ path: string; xml: string }> = [];
  const consumedFiles = new Set<string>();

  const explicitCandidates = Array.from(candidatePaths)
    .map((path) => normalizePath(path))
    .filter(Boolean);
  for (const path of explicitCandidates) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async('string');
    if (looksLikePoolXml(xml)) {
      poolDocs.push({ path, xml });
      consumedFiles.add(path);
    } else if (looksLikeQti12Xml(xml)) {
      qti12Docs.push({ path, xml });
      consumedFiles.add(path);
    }
  }

  if (!poolDocs.length) {
    const files = zip.file(/\.(dat|xml)$/i);
    for (const file of files) {
      if (file.dir) continue;
      const xml = await file.async('string');
      if (!looksLikePoolXml(xml)) continue;
      poolDocs.push({ path: normalizePath(file.name), xml });
      consumedFiles.add(normalizePath(file.name));
    }
  }

  const assets: ImportedAsset[] = [];
  for (const file of zip.file(/.*/)) {
    if (file.dir) continue;
    const filePath = normalizePath(file.name);
    if (!filePath || consumedFiles.has(filePath) || /imsmanifest\.xml$/i.test(filePath)) continue;
    if (/\.(xml|dat)$/i.test(filePath)) continue;
    const data = await file.async('uint8array');
    assets.push({
      path: filePath,
      name: filePath.split('/').pop() || filePath,
      data,
    });
  }

  return { poolDocs, qti12Docs, assets };
}

async function zipContainsPool(zip: ZipArchive): Promise<boolean> {
  const files = zip.file(/\.(dat|xml)$/i);
  for (const file of files) {
    if (file.dir) continue;
    const xml = await file.async('string');
    if (looksLikePoolXml(xml)) return true;
  }
  return false;
}

function looksLikePoolXml(xml: string): boolean {
  return /<POOL[\s>]/i.test(xml);
}

function looksLikeQti12Xml(xml: string): boolean {
  return /<questestinterop[\s>]/i.test(xml);
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1];
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function findQuestionElement(root: Element, klass: string, id: string): Element | null {
  const expectedName = klass.toLowerCase();
  const matches = childElements(root).filter((element) => localName(element) === expectedName);
  return matches.find((element) => (attr(element, 'id') ?? '') === id) ?? null;
}

function attrByLocalName(element: Element, key: string): string | null {
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute && (attribute.localName || attribute.name) === key) return attribute.value;
  }
  return null;
}

function readText(parent: Element | null, tagName: string): string {
  const child = findChildByLocalName(parent, tagName);
  return child?.textContent ?? '';
}

function toPosition(element: Element): number {
  const raw = attr(element, 'position');
  const num = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(num) ? num : Number.MAX_SAFE_INTEGER;
}

function choiceLabel(index: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (index < alphabet.length) return alphabet[index];
  return `C${index + 1}`;
}

function uniqueIdentifier(base: string, seen: Set<string>): string {
  let value = base;
  let counter = 1;
  while (seen.has(value)) {
    counter += 1;
    value = `${base}_${counter}`;
  }
  seen.add(value);
  return value;
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
}
