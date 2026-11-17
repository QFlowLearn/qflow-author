import { BANK_SELECTION_LIMIT } from './assessment_bank_selection.ts';
import type { LibraryItem } from './question_bank_picker.ts';
import { isCanonicalUuid } from './uuid.ts';
import {
  parseQuestionBankPickerQuery,
  QuestionBankInputError,
  type QuestionBankQuestionsQuery,
} from './services/question_bank_query.ts';

/** Explicit chooser dimension; topic selection never requires difficulty. */
export type ProposalMode = 'topic' | 'difficulty';
/** A selected immutable revision, including unsaved manual picker choices. */
export type ProposalExclusion = { readonly itemId: string; readonly revision: number };
/** Counts always refer to the configured labels of one immutable category version. */
export type ProposalCount = { readonly categoryId: string; readonly count: number };
/** The server inspects eligibility or draws a bounded sample; placement intent stays in the picker. */
export type BankProposalRequest =
  & { readonly mode: ProposalMode; readonly excludedQuestions: readonly ProposalExclusion[] }
  & (
    | { readonly kind: 'inspect' }
    | {
      readonly kind: 'draw';
      readonly versionId: string;
      readonly counts: readonly ProposalCount[];
    }
  );
/** Serialized bank filters cross the HTTP boundary once, through the canonical parser. */
export type BankProposalCommand = BankProposalRequest & { readonly selection: string };
/** Parsed criteria contain no parallel serialized filter representation. */
export type ParsedBankProposalCommand = BankProposalRequest & {
  readonly query: QuestionBankQuestionsQuery;
};
export type ProposalLevel = {
  readonly id: string;
  readonly label: string;
  readonly available: number;
};
export type ProposalVersion = {
  readonly id: string;
  readonly version: number;
  readonly audience: string;
  readonly levels: readonly ProposalLevel[];
  readonly unsupported: number;
};
export type ProposedQuestion = { readonly question: LibraryItem; readonly categoryId: string };
export type BankProposalResponse =
  & { readonly mode: ProposalMode }
  & (
    | { readonly kind: 'availability'; readonly versions: readonly ProposalVersion[] }
    | {
      readonly kind: 'proposal';
      readonly version: ProposalVersion;
      readonly items: readonly ProposedQuestion[];
    }
    | {
      readonly kind: 'shortfall';
      readonly version: ProposalVersion;
      readonly available: number;
    }
  );
export type BankProposalFailure =
  | 'invalid_input'
  | 'scheme_required'
  | 'category_required'
  | 'unsupported_selection'
  | 'forbidden'
  | 'not_found'
  | 'storage_failed';

/** Bound both the sample and exclusions. The selection owner enforces combined placement capacity. */
export function parseBankProposalCommand(value: unknown): ParsedBankProposalCommand | null {
  if (
    !isRecord(value) || typeof value.selection !== 'string' || value.selection.length > 8000 ||
    (value.mode !== 'topic' && value.mode !== 'difficulty') ||
    !Array.isArray(value.excludedQuestions) || value.excludedQuestions.length > BANK_SELECTION_LIMIT
  ) return null;
  let query: QuestionBankQuestionsQuery;
  try {
    query = parseQuestionBankPickerQuery(new URLSearchParams(value.selection));
  } catch (cause: unknown) {
    if (cause instanceof QuestionBankInputError) return null;
    throw cause;
  }
  const excludedQuestions: ProposalExclusion[] = [];
  for (const item of value.excludedQuestions) {
    if (
      !exact(item, ['itemId', 'revision']) || !isCanonicalUuid(item.itemId) ||
      typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 1
    ) return null;
    excludedQuestions.push({ itemId: item.itemId, revision: item.revision });
  }
  if (new Set(excludedQuestions.map((item) => item.itemId)).size !== excludedQuestions.length) {
    return null;
  }
  const mode: ProposalMode = value.mode;
  const scope = { mode, excludedQuestions, query };

  if (
    value.kind === 'inspect' && exact(value, ['kind', 'selection', 'excludedQuestions', 'mode'])
  ) {
    return { ...scope, kind: 'inspect' };
  }
  if (!isCanonicalUuid(value.versionId)) return null;
  if (
    value.kind !== 'draw' ||
    !exact(value, ['kind', 'selection', 'excludedQuestions', 'mode', 'versionId', 'counts']) ||
    !Array.isArray(value.counts) || !value.counts.length || value.counts.length > 100
  ) return null;
  const counts: ProposalCount[] = [];
  for (const entry of value.counts) {
    if (
      !exact(entry, ['categoryId', 'count']) || !categoryId(entry.categoryId) ||
      typeof entry.count !== 'number' || !Number.isSafeInteger(entry.count) || entry.count < 1 ||
      entry.count > BANK_SELECTION_LIMIT
    ) return null;
    counts.push({ categoryId: entry.categoryId, count: entry.count });
  }
  if (
    new Set(counts.map((entry) => entry.categoryId)).size !== counts.length ||
    counts.reduce((total, entry) => total + entry.count, 0) >
      BANK_SELECTION_LIMIT
  ) return null;
  return { ...scope, kind: 'draw', versionId: value.versionId, counts };
}
function categoryId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
