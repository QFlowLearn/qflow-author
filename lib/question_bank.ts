import { transcodeQti3Item } from '@longsightgroup/qti3-transcoder';
import { projectCanonicalQtiSemantics } from './question_qti_semantics.ts';
import { canonicalJsonStringify } from './canonical_json.ts';
import {
  assessmentExportTranscodeProfileId,
  listSelectableAssessmentExportTargets,
} from './export/assessment_export_targets.ts';
import { sha256Hex } from './sha256.ts';

import {
  parseQuestionCompatibility,
  type QuestionCompatibilityProjection,
} from './question_bank_contract.ts';
export {
  parseQuestionCompatibility,
  QUESTION_COMPATIBILITY_OUTCOMES,
  QUESTION_LIFECYCLE_STATES,
  QUESTION_REVIEW_STATES,
  type QuestionCompatibilityOutcome,
  type QuestionCompatibilityProjection,
  type QuestionLifecycleState,
  type QuestionReviewFacetState,
  type QuestionReviewState,
} from './question_bank_contract.ts';

/** Fields persisted beside every immutable revision for bank search and duplicate detection. */
export type QuestionBankRevisionProjection = {
  readonly contentHash: string;
  readonly searchText: string;
  readonly compatibility: readonly QuestionCompatibilityProjection[];
};

/** Precomputed compatibility bound to the semantic content that produced it. */
export type PrecomputedQuestionCompatibility = {
  readonly contentHash: string;
  readonly compatibility: readonly QuestionCompatibilityProjection[];
};

/** Parses a generated compatibility fixture without trusting its serialized representation. */
export function parsePrecomputedQuestionCompatibilityRecord(
  value: unknown,
): Readonly<Record<string, PrecomputedQuestionCompatibility>> {
  if (!isRecord(value)) throw new Error('Precomputed question compatibility must be an object.');
  const parsed: Record<string, PrecomputedQuestionCompatibility> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      !key || !isRecord(entry) || !hasExactKeys(entry, ['contentHash', 'compatibility']) ||
      typeof entry.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(entry.contentHash)
    ) {
      throw new Error('Precomputed question compatibility entry is invalid.');
    }
    parsed[key] = {
      contentHash: entry.contentHash,
      compatibility: parseQuestionCompatibility(entry.compatibility),
    };
  }
  return parsed;
}

/** Maximum indexed author-facing text stored for one immutable revision. */
export const QUESTION_SEARCH_TEXT_MAX_LENGTH = 64_000;

const AUTHOR_SEARCH_TEXT_FIELDS = new Set([
  'bodyhtml',
  'contenthtml',
  'html',
  'label',
  'mediatranscript',
  'note',
  'placeholdertext',
  'prompthtml',
  'rubrichtml',
  'text',
  'title',
]);

/** Computes the exact, immutable bank projection for a revision before it is inserted. */
export async function projectQuestionBankRevision(
  title: string,
  body: Record<string, unknown>,
  qtiXml: string,
): Promise<QuestionBankRevisionProjection> {
  const contentHash = await projectQuestionContentHash(qtiXml);
  return {
    contentHash,
    searchText: projectQuestionSearchText(title, body),
    compatibility: projectQuestionCompatibility(qtiXml),
  };
}

/**
 * Reuses a generated compatibility projection only when it matches the exact semantic content
 * and the currently registered export contracts.
 */
export async function projectQuestionBankRevisionFromPrecomputedCompatibility(
  title: string,
  body: Record<string, unknown>,
  qtiXml: string,
  precomputed: PrecomputedQuestionCompatibility,
): Promise<QuestionBankRevisionProjection> {
  const contentHash = await projectQuestionContentHash(qtiXml);
  if (contentHash !== precomputed.contentHash) {
    throw new Error('Precomputed question compatibility does not match the question content.');
  }
  return {
    contentHash,
    searchText: projectQuestionSearchText(title, body),
    compatibility: precomputed.compatibility,
  };
}

async function projectQuestionContentHash(qtiXml: string): Promise<string> {
  const semanticQti = projectCanonicalQtiSemantics(qtiXml);
  return await sha256Hex(
    new TextEncoder().encode(canonicalJsonStringify(semanticQti)),
  );
}

/** Projects searchable author-facing text once so list queries never scan serialized JSON. */
export function projectQuestionSearchText(
  title: string,
  body: Record<string, unknown>,
): string {
  const projection: SearchTextProjection = { values: [], length: 0 };
  appendSearchText(title, projection);
  collectSearchText(body, projection);
  return projection.values.join(' ');
}

type SearchTextProjection = {
  readonly values: string[];
  length: number;
};

function collectSearchText(
  value: unknown,
  projection: SearchTextProjection,
  field?: string,
): void {
  if (projection.length >= QUESTION_SEARCH_TEXT_MAX_LENGTH) return;
  if (typeof value === 'string') {
    if (field && isAuthorSearchTextField(field)) appendSearchText(value, projection);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSearchText(entry, projection, field);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (field === undefined && key === 'importWarnings') continue;
    collectSearchText(entry, projection, key);
  }
}

function isAuthorSearchTextField(field: string): boolean {
  const normalized = field.toLowerCase();
  return AUTHOR_SEARCH_TEXT_FIELDS.has(normalized) ||
    normalized.endsWith('alt') ||
    normalized.endsWith('feedback') ||
    normalized.endsWith('longdesc') ||
    normalized.endsWith('message') ||
    normalized.endsWith('title');
}

function appendSearchText(value: string, projection: SearchTextProjection): void {
  if (/^data:/i.test(value.trimStart())) return;
  const normalized = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return;
  const separatorLength = projection.values.length === 0 ? 0 : 1;
  const available = QUESTION_SEARCH_TEXT_MAX_LENGTH - projection.length - separatorLength;
  if (available <= 0) return;
  projection.values.push(normalized.slice(0, available));
  projection.length += Math.min(normalized.length, available) + separatorLength;
}

/** Runs the canonical revision through every selectable target; no target is inferred or skipped. */
export function projectQuestionCompatibility(
  qtiXml: string,
): readonly QuestionCompatibilityProjection[] {
  return listSelectableAssessmentExportTargets().map((target) => {
    const profileId = assessmentExportTranscodeProfileId(target);
    if (profileId === null) {
      return {
        targetId: target.id,
        targetContractId: target.targetContractId,
        outcome: 'exact',
        diagnosticCodes: [],
      };
    }
    const result = transcodeQti3Item({ kind: 'xml', xml: qtiXml }, { profile: profileId });
    return {
      targetId: target.id,
      targetContractId: target.targetContractId,
      outcome: result.ok ? result.fidelity : 'blocked',
      diagnosticCodes: result.diagnostics.map((diagnostic) => diagnostic.code),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
