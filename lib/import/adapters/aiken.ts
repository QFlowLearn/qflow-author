import { organizationGroupsFromParts } from '../organization_groups.ts';
import { sanitizeBodyHtml } from '../../sanitize.ts';
import { normalizeQtiIdentifier } from '../../qti_identifiers.ts';
import { xmlEscape } from '../../xml.ts';
import { IMPORT_ADAPTER_DESCRIPTORS } from '../adapter_descriptors.ts';
import { buildImportedItem } from '../imported_item_qti.ts';
import type {
  ImportAdapter,
  ImportedItem,
  ImportedPart,
  ImportedPlacement,
  ImportResult,
  ImportSource,
  SniffResult,
} from '../types.ts';

const CHOICE_RE = /^\s*([A-Z])[\.)]\s+(.+)$/m;
const ANSWER_RE = /^\s*ANSWER\s*:\s*([A-Z])\s*$/m;

export const aikenAdapter: ImportAdapter = {
  ...IMPORT_ADAPTER_DESCRIPTORS.aiken,
  sniff: sniffAiken,
  parse: parseAiken,
};

function sniffAiken(source: ImportSource): Promise<SniffResult> {
  const preview = decodeUtf8Lossy(source.bytes.slice(0, 8192));
  const hasChoice = CHOICE_RE.test(preview);
  const hasAnswer = ANSWER_RE.test(preview);
  if (!hasChoice || !hasAnswer) {
    return Promise.resolve({ supported: false, confidence: 0, reason: 'no-aiken-pattern' });
  }

  const filename = (source.filename ?? '').toLowerCase();
  const extBoost = filename.endsWith('.aiken') ? 0.25 : filename.endsWith('.txt') ? 0.1 : 0;
  return Promise.resolve({
    supported: true,
    confidence: Math.min(0.55 + extBoost, 0.9),
    reason: 'aiken-markers',
  });
}

function parseAiken(source: ImportSource): Promise<ImportResult> {
  const text = decodeUtf8Strict(source.bytes);
  const questions = parseQuestions(text);
  if (!questions.length) {
    throw new Error('No Aiken questions found.');
  }

  const usedIds = new Set<string>();
  const items: ImportedItem[] = [];
  const placements: ImportedPlacement[] = [];

  questions.forEach((question, index) => {
    const baseIdentifier = normalizeQtiIdentifier(question.prompt, `ITEM_${index + 1}`);
    const identifier = uniqueIdentifier(baseIdentifier, usedIds);
    const draft = {
      type: 'single_select' as const,
      title: question.prompt,
      bodyHtml: toBodyHtml(question.prompt),
      choices: question.choices.map((choice) => ({
        id: choice.letter,
        text: choice.text,
      })),
      correctId: question.correctLetter,
      shuffle: false,
    };

    const item = buildImportedItem({
      sourceFormat: 'aiken',
      draft,
      href: `${identifier}.xml`,
      identifier,
      title: question.prompt,
      sourceText: question.prompt,
    });
    items.push(item);
    placements.push({ href: item.href });
  });

  const parts: ImportedPart[] = [
    {
      id: 'part-1',
      title: 'Part 1',
      placements,
    },
  ];

  return Promise.resolve({
    title: 'Imported Aiken Quiz',
    parts,
    organizationGroups: organizationGroupsFromParts(parts),
    items,
    assets: [],
  });
}

type ParsedChoice = {
  letter: string;
  text: string;
};

type ParsedQuestion = {
  prompt: string;
  choices: ParsedChoice[];
  correctLetter: string;
};

function parseQuestions(raw: string): ParsedQuestion[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const questions: ParsedQuestion[] = [];
  let index = 0;

  while (index < lines.length) {
    while (index < lines.length && isBlank(lines[index])) index += 1;
    if (index >= lines.length) break;

    const questionLine = index + 1;
    const prompt = lines[index].trim();
    index += 1;

    if (!prompt) continue;

    const choices: ParsedChoice[] = [];
    while (index < lines.length && !isBlank(lines[index])) {
      const line = lines[index];
      if (ANSWER_RE.test(line)) break;
      const match = CHOICE_RE.exec(line);
      if (!match) {
        throw new Error(
          `Invalid Aiken format at line ${index + 1}: expected choice like "A. ..." or "A) ...".`,
        );
      }
      const letter = match[1].toUpperCase();
      const text = match[2].trim();
      if (!text) {
        throw new Error(`Invalid Aiken format at line ${index + 1}: choice text is empty.`);
      }
      if (choices.some((choice) => choice.letter === letter)) {
        throw new Error(
          `Invalid Aiken format at line ${index + 1}: duplicate choice letter ${letter}.`,
        );
      }
      choices.push({ letter, text });
      index += 1;
    }

    if (choices.length < 2) {
      throw new Error(
        `Invalid Aiken format at line ${questionLine}: question must include at least two choices.`,
      );
    }

    if (index >= lines.length || isBlank(lines[index])) {
      throw new Error(
        `Invalid Aiken format at line ${questionLine}: missing ANSWER line for question.`,
      );
    }

    const answerLine = lines[index];
    const answerMatch = ANSWER_RE.exec(answerLine);
    if (!answerMatch) {
      throw new Error(
        `Invalid Aiken format at line ${index + 1}: expected ANSWER line like "ANSWER: B".`,
      );
    }

    const correctLetter = answerMatch[1].toUpperCase();
    if (!choices.some((choice) => choice.letter === correctLetter)) {
      const available = choices.map((choice) => choice.letter).join(', ');
      throw new Error(
        `Invalid Aiken format at line ${
          index + 1
        }: ANSWER references choice ${correctLetter}, available choices are ${available}.`,
      );
    }

    questions.push({ prompt, choices, correctLetter });
    index += 1;

    while (index < lines.length && isBlank(lines[index])) index += 1;
  }

  return questions;
}

function uniqueIdentifier(base: string, seen: Set<string>): string {
  let identifier = base;
  let suffix = 1;
  while (seen.has(identifier)) {
    suffix += 1;
    identifier = `${base}_${suffix}`;
  }
  seen.add(identifier);
  return identifier;
}

function toBodyHtml(text: string): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return '<p></p>';
  return sanitizeBodyHtml(`<p>${xmlEscape(trimmed)}</p>`) || '<p></p>';
}

function isBlank(line: string | undefined): boolean {
  return !line || line.trim().length === 0;
}

function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_err) {
    throw new Error('Aiken import expects UTF-8 encoded text.');
  }
}

function decodeUtf8Lossy(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
