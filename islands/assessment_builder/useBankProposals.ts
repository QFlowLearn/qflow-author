import { reportUiError } from '../../lib/client/ui_event.ts';
import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  BankProposalCommand,
  BankProposalResponse,
  ProposalCount,
  ProposalMode,
} from '../../lib/bank_question_proposal.ts';
import { parseBankProposalResponse } from '../../lib/bank_question_proposal_response.ts';
import type {
  BankSelectionChange,
  SelectedBankQuestion,
} from '../../lib/assessment_bank_selection.ts';

type RequestFailure = {
  readonly kind: 'failed';
  readonly reason:
    | 'scheme_required'
    | 'category_required'
    | 'unsupported_selection'
    | 'invalid_input'
    | 'failed';
};
type Availability =
  | { readonly kind: 'loading' }
  | RequestFailure
  | Extract<BankProposalResponse, { kind: 'availability' }>;
type Action =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending'; readonly change: BankSelectionChange }
  | {
    readonly kind: 'rejected';
    readonly change: BankSelectionChange;
  }
    & ({ readonly reason: 'shortfall'; readonly available: number } | {
      readonly reason: 'failed';
    });

/** Counts refresh on scope changes; only an explicit author action draws or replaces questions. */
export function useBankProposals(input: {
  readonly assessmentId: string;
  readonly scope: string;
  readonly searchLoading: boolean;
  readonly selected: readonly SelectedBankQuestion[];
  readonly onAccept: (
    change: BankSelectionChange,
    result: Extract<BankProposalResponse, { kind: 'proposal' }>,
  ) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ProposalMode>('topic');
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; value: Availability } | null>(null);
  const [action, setAction] = useState<Action>({ kind: 'idle' });
  const active = useRef<AbortController | null>(null);
  const excludedQuestions = input.selected.map((item) => ({
    itemId: item.question.id,
    revision: item.question.latestRev,
  })).sort((a, b) => a.itemId.localeCompare(b.itemId));
  const key = JSON.stringify([mode, input.scope, excludedQuestions]);
  useEffect(() => {
    if (!open || input.searchLoading) return;
    const controller = new AbortController();
    async function inspect() {
      const result = await requestProposal(
        input.assessmentId,
        { kind: 'inspect', selection: input.scope, excludedQuestions, mode },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setLoaded({
        key,
        value: result.kind === 'availability' || result.kind === 'failed'
          ? result
          : { kind: 'failed', reason: 'failed' },
      });
    }
    setLoaded(null);
    setAction({ kind: 'idle' });
    inspect().catch(reportUiError);
    return () => controller.abort();
  }, [input.assessmentId, key, open, attempt, input.searchLoading]);
  useEffect(() => () => active.current?.abort(), []);

  async function draw(
    change: BankSelectionChange,
    versionId: string,
    counts: readonly ProposalCount[],
    drawMode: ProposalMode,
  ) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setAction({ kind: 'pending', change });
    try {
      const result = await requestProposal(
        input.assessmentId,
        {
          kind: 'draw',
          selection: change.selection,
          excludedQuestions,
          mode: drawMode,
          versionId,
          counts,
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (result.kind === 'proposal' && input.onAccept(change, result)) {
        setAction({ kind: 'idle' });
        setOpen(false);
        return;
      }
      if (result.kind === 'shortfall' && change.kind === 'append') {
        // The draw supplies the fresh count snapshot; there is no second shortage-count overlay.
        setLoaded((current) =>
          current?.key === key && current.value.kind === 'availability'
            ? {
              key,
              value: {
                kind: 'availability',
                mode: result.mode,
                versions: current.value.versions.map((version) =>
                  version.id === result.version.id ? result.version : version
                ),
              },
            }
            : current
        );
      }
      setAction(
        result.kind === 'shortfall'
          ? { kind: 'rejected', change, reason: 'shortfall', available: result.available }
          : { kind: 'rejected', change, reason: 'failed' },
      );
    } finally {
      active.current = null;
    }
  }
  const availability: Availability = !input.searchLoading && loaded?.key === key
    ? loaded.value
    : { kind: 'loading' };
  return {
    open,
    mode,
    setMode,
    action,
    availability,
    toggle() {
      setOpen((value) => !value);
    },
    retry() {
      setAttempt((value) => value + 1);
    },
    choose(versionId: string, counts: readonly ProposalCount[]) {
      return draw({ kind: 'append', selection: input.scope }, versionId, counts, mode);
    },
    replace(item: SelectedBankQuestion) {
      if (item.source.kind !== 'proposed') return Promise.resolve();
      return draw(
        { kind: 'replace', selection: item.source.selection, itemId: item.question.id },
        item.source.versionId,
        [{ categoryId: item.source.categoryId, count: 1 }],
        item.source.mode,
      );
    },
  };
}

/** One HTTP boundary for both availability and draws, preserving the caller's cancellation lifetime. */
async function requestProposal(
  assessmentId: string,
  command: BankProposalCommand,
  options: { readonly signal: AbortSignal },
): Promise<BankProposalResponse | RequestFailure | { readonly kind: 'cancelled' }> {
  try {
    const response = await fetch(`/api/assessments/${assessmentId}/question-proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
      signal: options.signal,
    });
    const raw: unknown = await response.json();
    const result = response.ok ? parseBankProposalResponse(raw, command) : null;
    if (result) return result;
    const reason = typeof raw === 'object' && raw !== null && 'error' in raw &&
        (raw.error === 'scheme_required' || raw.error === 'category_required' ||
          raw.error === 'unsupported_selection' ||
          raw.error === 'invalid_input')
      ? raw.error
      : 'failed';
    return { kind: 'failed', reason };
  } catch {
    return options.signal.aborted ? { kind: 'cancelled' } : { kind: 'failed', reason: 'failed' };
  }
}
