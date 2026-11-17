import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: ComponentChildren;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  class?: string;
  boxClass?: string;
  initialFocusSelector?: string;
  returnFocusRef?: { current: HTMLElement | null };
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export default function Modal(
  {
    open,
    onClose,
    children,
    ariaLabel,
    ariaLabelledBy,
    class: cls,
    boxClass,
    initialFocusSelector,
    returnFocusRef,
  }: ModalProps,
) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const currentDialog: HTMLDialogElement = dialog;

    if (!open) {
      if (currentDialog.open) currentDialog.close();
      return;
    }

    previousFocusRef.current = returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    if (!currentDialog.open) currentDialog.showModal();
    setTimeout(() => findInitialFocusTarget(currentDialog, initialFocusSelector)?.focus(), 0);

    function handleCancel(event: Event) {
      event.preventDefault();
      onCloseRef.current();
    }

    currentDialog.addEventListener('cancel', handleCancel);

    return () => {
      currentDialog.removeEventListener('cancel', handleCancel);
      if (currentDialog.open) currentDialog.close();
      document.body.style.overflow = previousOverflow;
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus && document.contains(previousFocus)) {
        setTimeout(() => {
          // A newly opened editor may already own focus; delayed cleanup must not steal it.
          const active = document.activeElement;
          if (
            active === document.body || active === previousFocus ||
            (active && currentDialog.contains(active))
          ) previousFocus.focus();
        }, 50);
      }
    };
  }, [initialFocusSelector, open, returnFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      class={['ds-modal', cls || ''].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-modal='true'
      onClick={(event) => {
        if (event.target === dialogRef.current) onCloseRef.current();
      }}
    >
      <div class={['ds-modal-box', boxClass || ''].filter(Boolean).join(' ')}>
        {children}
      </div>
    </dialog>
  );
}

function findInitialFocusTarget(
  dialog: HTMLDialogElement,
  preferredSelector?: string,
): HTMLElement | null {
  if (preferredSelector) {
    const preferred = dialog.querySelector<HTMLElement>(preferredSelector);
    if (preferred && isFocusable(preferred)) return preferred;
  }
  return getFocusableElements(dialog)[0] ?? null;
}

function getFocusableElements(root: Pick<ParentNode, 'querySelectorAll'>): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isFocusable);
}

function isFocusable(element: HTMLElement): boolean {
  return element.tabIndex >= 0 &&
    !element.hasAttribute('disabled') &&
    element.getAttribute('aria-hidden') !== 'true' &&
    Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}
