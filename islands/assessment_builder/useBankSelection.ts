import { useRef, useState } from 'preact/hooks';
import {
  applyBankProposal,
  BANK_SELECTION_LIMIT,
  type BankSelectionChange,
  type BankSelectionCommand,
  type BankSelectionResult,
  parseBankSelectionResult,
  type SelectedBankQuestion,
} from '../../lib/assessment_bank_selection.ts';
import type { LibraryItem } from '../../lib/question_bank_picker.ts';
import type { BankProposalResponse } from '../../lib/bank_question_proposal.ts';

type AddState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'adding' }
  | { readonly kind: 'added'; readonly count: number }
  | {
    readonly kind: 'failed';
    readonly reason: 'conflict' | 'unavailable' | 'unsupported_selection' | 'failed';
  };

/** Owns selection across pages and one retry-safe, atomic append request. */
export function useBankSelection(input: {
  readonly assessmentId: string;
  readonly partId: string;
  readonly beforePlacementId?: string;
  readonly onAdded: (result: BankSelectionResult) => void;
}) {
  const [selected, setSelected] = useState<readonly SelectedBankQuestion[]>([]);
  const [state, setState] = useState<AddState>({ kind: 'idle' });
  const busy = useRef(false);
  function toggle(item: LibraryItem) {
    if (busy.current) return;
    setState({ kind: 'idle' });
    setSelected((current) => {
      if (current.some((entry) => entry.question.id === item.id)) {
        return current.filter((entry) => entry.question.id !== item.id);
      }
      if (current.length >= BANK_SELECTION_LIMIT) return current;
      return [...current, {
        placementId: crypto.randomUUID(),
        question: item,
        source: { kind: 'manual' },
      }];
    });
  }
  function remove(itemId: string) {
    if (busy.current) return;
    setSelected((current) => current.filter((entry) => entry.question.id !== itemId));
    setState({ kind: 'idle' });
  }
  function clear() {
    if (busy.current) return;
    setSelected([]);
    setState({ kind: 'idle' });
  }
  async function add() {
    if (busy.current || !selected.length) return;
    busy.current = true;
    setState({ kind: 'adding' });
    const command: BankSelectionCommand = {
      partId: input.partId,
      beforePlacementId: input.beforePlacementId,
      items: selected.map(({ placementId, question, source }) => ({
        placementId,
        itemId: question.id,
        revision: question.latestRev,
        proposal: source.kind === 'manual' ? null : {
          mode: source.mode,
          selection: source.selection,
          versionId: source.versionId,
          categoryId: source.categoryId,
        },
      })),
    };
    try {
      const response = await fetch(`/api/assessments/${input.assessmentId}/placements`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
      });
      const raw: unknown = await response.json().catch(() => null);
      const result = response.ok ? parseBankSelectionResult(raw, command) : null;
      if (!result) {
        const reason = typeof raw === 'object' && raw !== null && 'error' in raw &&
            (raw.error === 'conflict' || raw.error === 'unavailable' ||
              raw.error === 'unsupported_selection')
          ? raw.error
          : 'failed';
        setState({ kind: 'failed', reason });
        return;
      }
      input.onAdded(result);
      setSelected([]);
      setState({ kind: 'added', count: result.items.length });
    } catch {
      // Retain placement IDs and revisions: the server may have committed before a connection failed.
      setState({ kind: 'failed', reason: 'failed' });
    } finally {
      busy.current = false;
    }
  }
  function acceptProposal(
    change: BankSelectionChange,
    response: Extract<BankProposalResponse, { kind: 'proposal' }>,
  ): boolean {
    if (busy.current) return false;
    const next = applyBankProposal(selected, change, response, () => crypto.randomUUID());
    if (!next) return false;
    setSelected(next);
    setState({ kind: 'idle' });
    return true;
  }
  return { selected, state, toggle, remove, clear, add, acceptProposal };
}
