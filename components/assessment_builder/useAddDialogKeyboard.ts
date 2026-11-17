import { useEffect } from 'preact/hooks';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import { AUTHORABLE_QUESTION_TYPES } from '../../lib/authoring/question_type_catalog.ts';

/** Registers the add-question keyboard shortcuts while the builder is active. */
export function useAddDialogKeyboard(
  open: boolean,
  setOpen: (value: boolean | ((prev: boolean) => boolean)) => void,
  onChooseType: (type: QuestionTypeId) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const tag = target?.tagName.toLowerCase();
      if (open && target?.closest('[data-library-picker]')) return;
      if (
        tag === 'input' || tag === 'textarea' || tag === 'select' ||
        target?.isContentEditable === true ||
        (e as KeyboardEvent & { isComposing?: boolean }).isComposing
      ) {
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        setOpen((s) => !s);
        e.preventDefault();
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < AUTHORABLE_QUESTION_TYPES.length) {
        onChooseType(AUTHORABLE_QUESTION_TYPES[idx].id);
      }
    }
    globalThis.addEventListener('keydown', onKey as EventListener);
    return () => globalThis.removeEventListener('keydown', onKey as EventListener);
  }, [open, onChooseType, setOpen, enabled]);
}
