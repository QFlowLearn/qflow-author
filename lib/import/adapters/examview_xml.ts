import { organizationGroupsFromParts } from '../organization_groups.ts';
import { buildPackageEvidenceDocument } from '../../conversion/extract_package_source.ts';
import { createPackageIdentifierFactory } from '../../qti_identifiers.ts';
import { IMPORT_ADAPTER_DESCRIPTORS } from '../adapter_descriptors.ts';
import type {
  ImportAdapter,
  ImportedPart,
  ImportResult,
  ImportSource,
  SniffResult,
} from '../types.ts';
import { buildExamViewImportedItem } from './examview_xml_drafts.ts';
import {
  classifyExamViewXml,
  type ParsedExamViewDocument,
  parseExamViewXml,
} from './examview_xml_parser.ts';

/** Typed boundary error for invalid or unsupported ExamView XML. */
class ExamViewXmlFormatError extends Error {
  readonly _tag = 'ExamViewXmlFormatError' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ExamViewXmlFormatError';
  }
}

/** Deterministic adapter for the published ExamView XML 4 interchange format. */
export const examViewXmlAdapter: ImportAdapter = {
  ...IMPORT_ADAPTER_DESCRIPTORS.examViewXml,
  sniff: sniffExamViewXml,
  parse: parseExamViewSource,
};

function sniffExamViewXml(source: ImportSource): Promise<SniffResult> {
  let xml: string;
  try {
    xml = decodeUtf8Strict(source.bytes);
  } catch (_cause: unknown) {
    return Promise.resolve({ supported: false, confidence: 0, reason: 'invalid-utf8' });
  }
  const classification = classifyExamViewXml(xml);
  switch (classification._tag) {
    case 'supported':
      return Promise.resolve({
        supported: true,
        confidence: 0.99,
        reason: 'examview-xml-4-root',
      });
    case 'unsupported_version':
      return Promise.resolve({
        supported: false,
        confidence: 0.7,
        reason: 'examview-xml-version-unsupported',
      });
    case 'invalid_xml':
      return Promise.resolve({ supported: false, confidence: 0, reason: 'invalid-xml' });
    case 'not_examview':
      return Promise.resolve({ supported: false, confidence: 0, reason: 'no-examview-root' });
  }
}

function parseExamViewSource(source: ImportSource): Promise<ImportResult> {
  return Promise.resolve().then(() => {
    const xml = decodeUtf8Strict(source.bytes);
    const parsed = parseExamViewXml(xml);
    if (parsed._tag === 'invalid') {
      throw new ExamViewXmlFormatError(
        parsed.issues.map((issue) => issue.message).join(' '),
      );
    }

    const createIdentifier = createPackageIdentifierFactory();
    const built = parsed.value.entries.map((entry, index) => {
      const sourceId = entry._tag === 'question' ? entry.question.sourceId : entry.group.sourceId;
      const identifier = createIdentifier(sourceId, `examview-${index + 1}`);
      const href = `examview/${identifier}.xml`;
      return buildExamViewImportedItem(entry, identifier, href);
    });
    const items = built.map((entry) => entry.item);
    const warnings = [
      ...parsed.value.diagnostics,
      ...built.flatMap((entry) => entry.warnings),
    ];
    const parts: ImportedPart[] = [{
      id: 'part-1',
      title: 'Part 1',
      placements: items.map((item) => ({ href: item.href })),
    }];
    const title = parsed.value.title ?? assessmentTitle(source.filename);
    return {
      title,
      parts,
      organizationGroups: organizationGroupsFromParts(parts),
      items,
      assets: [],
      warnings: warnings.length > 0 ? warnings : undefined,
      normalizedSource: buildNormalizedSource(title, parsed.value),
    };
  });
}

function buildNormalizedSource(
  title: string,
  parsed: ParsedExamViewDocument,
): ReturnType<typeof buildPackageEvidenceDocument> {
  return buildPackageEvidenceDocument({
    title,
    entries: [
      ...parsed.documentEvidence.map((evidence) => ({
        id: evidence.blockId,
        text: evidence.quote,
      })),
      ...parsed.entries.map((entry) => {
        const evidence = entry._tag === 'question' ? entry.question.evidence : entry.group.evidence;
        return {
          id: evidence.blockId,
          text: evidence.quote,
        };
      }),
    ],
    uncertaintyMessage:
      'Normalized view reconstructs review evidence from ExamView XML fields recognized by the import adapter; original XML remains the authority.',
  });
}

function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_cause: unknown) {
    throw new ExamViewXmlFormatError('ExamView XML must use UTF-8 encoding.');
  }
}

function assessmentTitle(filename: string | undefined): string {
  const value = filename?.trim();
  if (!value) return 'Imported ExamView assessment';
  const withoutExtension = value.replace(/\.xml$/i, '').trim();
  return withoutExtension || 'Imported ExamView assessment';
}
