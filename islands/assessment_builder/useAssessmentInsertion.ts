import { useRef, useState } from 'preact/hooks';
import type { AuthoringState, Part } from './types.ts';

export type AssessmentInsertionMethod =
  | 'create'
  | 'library'
  | 'text'
  | 'content'
  | 'image'
  | 'video';

type Target = { readonly partId: string; readonly beforePlacementId?: string };

/** Owns explicit insertion destinations shared by the toolbar, header and question actions. */
export function useAssessmentInsertion(parts: readonly Part[], state: AuthoringState) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<AssessmentInsertionMethod>('create');
  const [target, setTarget] = useState<Target | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  function show(next: Target | null, tab: typeof method = 'create', source?: HTMLElement) {
    trigger.current = source ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setTarget(next);
    setMethod(tab);
    setOpen(true);
  }
  function selectedTarget(): Target | null {
    if (state._tag === 'Editing' || state._tag === 'EditingContent') {
      const part = parts.find((entry) => entry.id === state.partId);
      const selected = state._tag === 'EditingContent' ? state.placement.id : state.placementId;
      const index = part?.placements.findIndex((entry) => entry.id === selected) ?? -1;
      if (!part || index < 0) throw new Error('Selected content has no insertion destination.');
      return { partId: part.id, beforePlacementId: part.placements[index + 1]?.id };
    }
    if (state._tag === 'Creating' || state._tag === 'CreatingContent') {
      return { partId: state.partId, beforePlacementId: state.beforePlacementId };
    }
    return parts.length === 1 ? { partId: parts[0].id } : null;
  }
  function openSelected(tab: typeof method = 'create') {
    show(selectedTarget(), tab);
  }
  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  return {
    open,
    method,
    selectMethod: setMethod,
    target,
    trigger: trigger.current,
    part: parts.find((entry) => entry.id === target?.partId),
    openSelected,
    selectedTarget,
    openAt: (partId: string, beforePlacementId?: string, source?: HTMLElement) =>
      show({ partId, beforePlacementId }, 'create', source),
    selectPart: (partId: string) => {
      if (!parts.some((entry) => entry.id === partId)) throw new Error('Unknown insertion part.');
      setTarget({ partId });
    },
    close,
    finish: () => setOpen(false),
  };
}
