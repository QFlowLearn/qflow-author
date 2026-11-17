import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  PlacementRemovalCommand,
  PlacementRemovalReceipt,
  PlacementRemovalResult,
} from '../../lib/assessment_placement_removal.ts';
import type { PlacementRecoveryClientFailure } from '../../lib/client/assessment_placement_recovery.ts';
import type {
  AuthoringState,
  ItemActionBusy,
  ItemMeta,
  Part,
} from '../../islands/assessment_builder/types.ts';
import type { AssessmentBlueprint } from '../../lib/assessment_blueprint.ts';
import { insertAssessmentPlacements } from '../../lib/assessment_insertion.ts';
import { itemMetaFromDraft } from '../../islands/assessment_builder/assessment_questions.ts';

/** A notice retains its receipt after failure so a retry cannot create a different command. */
export type PlacementRecoveryNotice =
  | {
    readonly _tag: 'Pending';
    readonly receipt: PlacementRemovalReceipt;
    readonly failure?: PlacementRecoveryClientFailure;
  }
  | { readonly _tag: 'Restored' | 'ReloadRequired'; readonly receipt: PlacementRemovalReceipt }
  | {
    readonly _tag: 'HistoryFailed' | 'RemoveFailed';
    readonly failure: PlacementRecoveryClientFailure;
  };

type Options = {
  readonly assessmentId: string;
  readonly initialHistory: PlacementRemovalResult<readonly PlacementRemovalReceipt[]>;
  readonly parts: Part[];
  readonly setParts: (update: (parts: Part[]) => Part[]) => void;
  readonly itemMeta: Readonly<Record<string, ItemMeta>>;
  readonly setItemMeta: (
    update: (items: Record<string, ItemMeta>) => Record<string, ItemMeta>,
  ) => void;
  readonly blueprint: AssessmentBlueprint;
  readonly authoringState: AuthoringState;
  readonly setAuthoringState: (state: AuthoringState) => void;
  readonly actionBusy: ItemActionBusy;
  readonly setActionBusy: (busy: ItemActionBusy) => void;
};

/** Own saved membership recovery without loading a different editor or overwriting its draft. */
export function useAssessmentPlacementRecovery(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const history = useRef(options.initialHistory.ok ? [...options.initialHistory.value] : []);
  const [notice, setNotice] = useState<PlacementRecoveryNotice | null>(() =>
    options.initialHistory.ok
      ? history.current[0] ? { _tag: 'Pending', receipt: history.current[0] } : null
      : { _tag: 'HistoryFailed', failure: options.initialHistory.code }
  );
  const [announcement, setAnnouncement] = useState<
    { readonly _tag: 'Removed' | 'Restored'; readonly title: string } | null
  >(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const pending = useRef(false);
  const command = useRef<(PlacementRemovalCommand & { readonly placementId: string }) | null>(null);
  const lifecycle = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => {
      controller.abort();
      lifecycle.current = null;
    };
  }, []);

  function nextReceipt(excluding?: string) {
    return history.current.find((row) =>
      row.id !== excluding && Date.parse(row.expiresAt) > Date.now()
    );
  }
  function dismiss() {
    if (pending.current) return;
    if (notice && 'receipt' in notice) {
      history.current = history.current.filter((row) => row.id !== notice.receipt.id);
    }
    const next = nextReceipt();
    setNotice(next ? { _tag: 'Pending', receipt: next } : null);
  }

  async function remove() {
    const current = latest.current;
    if (
      pending.current || current.actionBusy || current.authoringState._tag !== 'Editing' ||
      !lifecycle.current
    ) return;
    const placementId = current.authoringState.placementId;
    const expectedRevision = current.itemMeta[placementId]?.latestRev;
    if (expectedRevision === undefined) {
      setNotice({ _tag: 'RemoveFailed', failure: 'invalid_response' });
      return;
    }
    if (
      command.current?.placementId !== placementId ||
      command.current.expectedRevision !== expectedRevision
    ) {
      command.current = { placementId, removalId: crypto.randomUUID(), expectedRevision };
    }
    const captured = command.current;
    const controller = lifecycle.current;
    pending.current = true;
    current.setActionBusy('delete');
    try {
      const api = await import('../../lib/client/assessment_placement_recovery.ts');
      if (controller.signal.aborted) return;
      const result = await api.requestPlacementRemoval(current.assessmentId, placementId, {
        removalId: captured.removalId,
        expectedRevision: captured.expectedRevision,
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setNotice({ _tag: 'RemoveFailed', failure: result.code });
        return;
      }
      command.current = null;
      history.current = [
        result.value,
        ...history.current.filter((row) => row.id !== result.value.id),
      ];
      const active = latest.current;
      active.setParts((parts) =>
        parts.map((part) => ({
          ...part,
          placements: part.placements.filter((row) => row.id !== placementId),
        }))
      );
      active.setItemMeta((items) => {
        const { [placementId]: _removed, ...rest } = items;
        return rest;
      });
      if (
        active.authoringState._tag === 'Editing' &&
        active.authoringState.placementId === placementId
      ) {
        active.setAuthoringState({ _tag: 'Idle' });
        setFocusRequest((value) => value + 1);
      }
      setNotice({ _tag: 'Pending', receipt: result.value });
      setAnnouncement({ _tag: 'Removed', title: result.value.title });
    } catch (_cause: unknown) {
      if (!controller.signal.aborted) {
        setNotice({ _tag: 'RemoveFailed', failure: 'request_failed' });
      }
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) latest.current.setActionBusy(null);
    }
  }

  async function restore(receipt: PlacementRemovalReceipt) {
    const current = latest.current, controller = lifecycle.current;
    if (pending.current || current.actionBusy || !controller) return;
    pending.current = true;
    current.setActionBusy('restore');
    let committed: PlacementRemovalReceipt | null = null;
    try {
      const api = await import('../../lib/client/assessment_placement_recovery.ts');
      if (controller.signal.aborted) return;
      const result = await api.requestPlacementRestoration(
        current.assessmentId,
        receipt.id,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setNotice({ _tag: 'Pending', receipt, failure: result.code });
        return;
      }
      const { placement, beforePlacementId, revision, draft } = result.value;
      committed = result.value.receipt;
      history.current = history.current.filter((row) => row.id !== receipt.id);
      const active = latest.current;
      const part = active.parts.find((row) => row.id === placement.partId);
      const existing = active.parts.flatMap((row) => row.placements).find((row) =>
        row.id === placement.id
      );
      if (
        !part ||
        (existing
          ? !part.placements.includes(existing) || !('itemId' in existing) ||
            existing.itemId !== placement.itemId
          : beforePlacementId !== null &&
            !part.placements.some((row) => row.id === beforePlacementId))
      ) {
        setNotice({ _tag: 'ReloadRequired', receipt: result.value.receipt });
        return;
      }
      if (!existing) {
        const meta = itemMetaFromDraft(placement.id, placement.itemId, revision, draft, {
          blueprint: active.blueprint,
          blueprintTargetId: placement.blueprintTargetId ?? undefined,
        });
        const restored = {
          id: placement.id,
          itemId: placement.itemId,
          snapshotRev: placement.snapshotRev ?? undefined,
          blueprintTargetId: placement.blueprintTargetId ?? undefined,
          fixed: placement.fixed,
        };
        active.setParts((parts) =>
          parts.map((row) =>
            row.id === placement.partId
              ? {
                ...row,
                placements: insertAssessmentPlacements(
                  row.placements,
                  [restored],
                  beforePlacementId ?? undefined,
                ),
              }
              : row
          )
        );
        active.setItemMeta((items) => ({
          ...items,
          [placement.id]: meta,
        }));
      }
      const next = nextReceipt();
      setNotice(
        next
          ? { _tag: 'Pending', receipt: next }
          : { _tag: 'Restored', receipt: result.value.receipt },
      );
      setAnnouncement({ _tag: 'Restored', title: draft.title ?? receipt.title });
    } catch (_cause: unknown) {
      if (!controller.signal.aborted) {
        setNotice(
          committed
            ? { _tag: 'ReloadRequired', receipt: committed }
            : { _tag: 'Pending', receipt, failure: 'request_failed' },
        );
      }
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) latest.current.setActionBusy(null);
    }
  }

  async function retryHistory() {
    const current = latest.current, controller = lifecycle.current;
    if (pending.current || current.actionBusy || !controller) return;
    pending.current = true;
    current.setActionBusy('restore');
    try {
      const api = await import('../../lib/client/assessment_placement_recovery.ts');
      if (controller.signal.aborted) return;
      const result = await api.requestPlacementRemovalHistory(
        current.assessmentId,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setNotice({ _tag: 'HistoryFailed', failure: result.code });
        return;
      }
      history.current = [...result.value];
      const next = nextReceipt();
      setNotice(next ? { _tag: 'Pending', receipt: next } : null);
    } catch (_cause: unknown) {
      if (!controller.signal.aborted) {
        setNotice({ _tag: 'HistoryFailed', failure: 'request_failed' });
      }
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) latest.current.setActionBusy(null);
    }
  }
  return { notice, announcement, focusRequest, remove, restore, dismiss, retryHistory };
}
