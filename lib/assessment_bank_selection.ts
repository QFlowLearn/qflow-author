import type { LibraryItem } from './question_bank_picker.ts';
import {
  type BankProposalResponse,
  parseBankProposalCommand,
  type ProposalMode,
} from './bank_question_proposal.ts';
import type { QuestionBankQuestionsQuery } from './services/question_bank_query.ts';
import { isCanonicalUuid } from './uuid.ts';
import { parseValidPersistedDraft, type PersistedDraft } from './persisted_draft.ts';

/** Maximum questions in one picker selection, including manual and proposed choices. */
export const BANK_SELECTION_LIMIT = 100;

/** Stable placement identity makes retrying the same selected revision safe. */
export type BankSelectedQuestion = {
  readonly placementId: string;
  readonly itemId: string;
  readonly revision: number;
};
/** Append selected revisions to an explicitly chosen assessment part. */
export type BankSelectionCommand = {
  readonly beforePlacementId?: string;
  readonly partId: string;
  readonly items: readonly (BankSelectedQuestion & {
    readonly proposal: null | {
      readonly mode: ProposalMode;
      readonly selection: string;
      readonly versionId: string;
      readonly categoryId: string;
    };
  })[];
};
/** Parsed automatic intent remains attached until the atomic add rechecks scope and equality. */
export type ParsedBankSelectionCommand = {
  readonly beforePlacementId?: string;
  readonly partId: string;
  readonly items: readonly (BankSelectedQuestion & {
    readonly proposal: {
      readonly mode: ProposalMode;
      readonly query: QuestionBankQuestionsQuery;
      readonly versionId: string;
      readonly categoryId: string;
    } | null;
  })[];
};
/** Saved content lets the builder update without a document reload. */
export type BankSelectionResult = {
  readonly partId: string;
  readonly items: readonly (BankSelectedQuestion & { readonly draft: PersistedDraft })[];
};

/** A selection retains the exact previewed summary and its sampling scope across filter changes. */
export type SelectedBankQuestion = {
  readonly placementId: string;
  readonly question: LibraryItem;
  readonly source: { readonly kind: 'manual' } | {
    readonly kind: 'proposed';
    readonly selection: string;
    readonly versionId: string;
    readonly categoryId: string;
    readonly categoryLabel: string;
    readonly mode: ProposalMode;
    readonly audience: string;
  };
};

/** Local placement intent; the read-only sampling service does not own the unsaved selection. */
export type BankSelectionChange =
  & { readonly selection: string }
  & (
    | { readonly kind: 'append' }
    | { readonly kind: 'replace'; readonly itemId: string }
  );

/** Apply an explicit proposal atomically, preserving manual choices, order, and the selection cap. */
export function applyBankProposal(
  current: readonly SelectedBankQuestion[],
  change: BankSelectionChange,
  proposal: Extract<BankProposalResponse, { kind: 'proposal' }>,
  newPlacementId: () => string,
): readonly SelectedBankQuestion[] | null {
  if (
    change.kind === 'replace' &&
    (proposal.items.length !== 1 ||
      !current.some((item) =>
        item.question.id === change.itemId && item.source.kind === 'proposed'
      ))
  ) return null;
  const retained = change.kind === 'replace'
    ? current.filter((item) => item.question.id !== change.itemId)
    : current;
  const ids = [
    ...retained.map((item) => item.question.id),
    ...proposal.items.map((item) => item.question.id),
  ];
  if (ids.length > BANK_SELECTION_LIMIT || new Set(ids).size !== ids.length) return null;
  const incoming: SelectedBankQuestion[] = [];
  for (const { question, categoryId } of proposal.items) {
    const level = proposal.version.levels.find((level) => level.id === categoryId);
    if (!level) return null;
    incoming.push({
      placementId: newPlacementId(),
      question,
      source: {
        kind: 'proposed',
        selection: change.selection,
        versionId: proposal.version.id,
        categoryId,
        categoryLabel: level.label,
        mode: proposal.mode,
        audience: proposal.version.audience,
      },
    });
  }
  return change.kind === 'append'
    ? [...current, ...incoming]
    : current.map((item) => item.question.id === change.itemId ? incoming[0] : item);
}

/** Parse a bounded selection, rejecting duplicate questions and placement IDs. */
export function parseBankSelectionCommand(value: unknown): ParsedBankSelectionCommand | null {
  if (
    !record(value) ||
    !keys(
      value,
      Object.hasOwn(value, 'beforePlacementId')
        ? ['partId', 'items', 'beforePlacementId']
        : ['partId', 'items'],
    ) ||
    !isCanonicalUuid(value.partId)
  ) {
    return null;
  }
  if (
    !Array.isArray(value.items) || !value.items.length || value.items.length > BANK_SELECTION_LIMIT
  ) return null;
  const items: ParsedBankSelectionCommand['items'][number][] = [];
  for (const item of value.items) {
    if (!record(item) || !keys(item, ['placementId', 'itemId', 'revision', 'proposal'])) {
      return null;
    }
    const parsed = selection(item);
    if (!parsed) return null;
    if (item.proposal === null) {
      items.push({ ...parsed, proposal: null });
      continue;
    }
    if (
      !record(item.proposal) ||
      !keys(item.proposal, ['mode', 'selection', 'versionId', 'categoryId'])
    ) return null;
    const proposal = parseBankProposalCommand({
      kind: 'draw',
      mode: item.proposal.mode,
      selection: item.proposal.selection,
      excludedQuestions: [],
      versionId: item.proposal.versionId,
      counts: [{ categoryId: item.proposal.categoryId, count: 1 }],
    });
    if (!proposal || proposal.kind !== 'draw') return null;
    items.push({
      ...parsed,
      proposal: {
        mode: proposal.mode,
        query: proposal.query,
        versionId: proposal.versionId,
        categoryId: proposal.counts[0].categoryId,
      },
    });
  }
  if (
    new Set(items.map((item) => item.itemId)).size !== items.length ||
    new Set(items.map((item) => item.placementId)).size !== items.length
  ) return null;
  if (value.beforePlacementId !== undefined && !isCanonicalUuid(value.beforePlacementId)) {
    return null;
  }
  return {
    partId: value.partId,
    items,
    ...(value.beforePlacementId === undefined
      ? {}
      : { beforePlacementId: value.beforePlacementId }),
  };
}

/** Accept only an acknowledgement of exactly the submitted revisions and placements. */
export function parseBankSelectionResult(
  value: unknown,
  command: { readonly partId: string; readonly items: readonly BankSelectedQuestion[] },
): BankSelectionResult | null {
  if (
    !record(value) || !keys(value, ['partId', 'items']) || value.partId !== command.partId ||
    !Array.isArray(value.items) || value.items.length !== command.items.length
  ) return null;
  const items: BankSelectionResult['items'][number][] = [];
  for (const [index, raw] of value.items.entries()) {
    if (!record(raw) || !keys(raw, ['placementId', 'itemId', 'revision', 'draft'])) return null;
    const parsed = selection(raw), expected = command.items[index];
    if (
      !parsed || !expected || parsed.placementId !== expected.placementId ||
      parsed.itemId !== expected.itemId || parsed.revision !== expected.revision
    ) return null;
    try {
      items.push({ ...parsed, draft: parseValidPersistedDraft(raw.draft) });
    } catch {
      return null;
    }
  }
  return { partId: command.partId, items };
}

function selection(value: Record<string, unknown>): BankSelectedQuestion | null {
  if (
    !isCanonicalUuid(value.placementId) || !isCanonicalUuid(value.itemId) ||
    typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  ) return null;
  return { placementId: value.placementId, itemId: value.itemId, revision: value.revision };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key));
}
