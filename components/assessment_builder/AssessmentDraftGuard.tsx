import { uiEvent } from '../../lib/client/ui_event.ts';
import { type RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../ui/Button.tsx';
import Modal from '../ui/Modal.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import { useItemEditorState } from '../../islands/item_editor/context.ts';

/** A continuation is permitted only after explicit discard or a successful unchanged save. */
export type DraftGuard = () => Promise<boolean>;

/** Protects the current editor when insertion or selection would replace its draft. */
export default function AssessmentDraftGuard(
  props: { readonly guard: RefObject<DraftGuard | null> },
) {
  const { persistence } = useItemEditorState();
  const i18n = useI18n();
  return (
    <AssessmentDraftSwitchGuard
      guard={props.guard}
      title={i18n.t('assessments.builder.keepDraftTitle')}
      help={i18n.t('assessments.builder.keepDraftHelp')}
      draft={{
        dirty: persistence.saveStatus === 'dirty',
        blocked: persistence.saveStatus === 'saving',
        canSave: persistence.canSave,
        error: persistence.error,
        errors: persistence.errors,
        save: persistence.save,
      }}
    />
  );
}

/** Shared draft protection for question and unscored content editors. */
export function AssessmentDraftSwitchGuard(props: {
  readonly guard: RefObject<DraftGuard | null>;
  readonly title: string;
  readonly help: string;
  readonly draft: {
    readonly dirty: boolean;
    readonly blocked: boolean;
    readonly canSave: boolean;
    readonly error: string | null;
    readonly errors: readonly string[];
    readonly save: () => Promise<boolean>;
    readonly discard?: () => void;
  };
}) {
  const persistence = props.draft;
  const current = useRef(persistence);
  current.current = persistence;
  const pending = useRef<((proceed: boolean) => void) | null>(null);
  const continuingSave = useRef(false);
  const [open, setOpen] = useState(false);
  const i18n = useI18n();
  const saving = persistence.blocked;
  function finish(proceed: boolean) {
    pending.current?.(proceed);
    pending.current = null;
    setOpen(false);
  }
  useEffect(() => {
    props.guard.current = () => {
      if (current.current.blocked || pending.current) return Promise.resolve(false);
      if (!current.current.dirty) return Promise.resolve(true);
      setOpen(true);
      return new Promise((resolve) => {
        pending.current = resolve;
      });
    };
    return () => {
      props.guard.current = null;
      if (!continuingSave.current) pending.current?.(false);
    };
  }, [props.guard]);
  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) finish(false);
      }}
      ariaLabel={props.title}
      initialFocusSelector='[data-cancel-draft]'
    >
      <h2 class='text-lg font-semibold'>{props.title}</h2>
      <p class='my-4'>{props.help}</p>
      {persistence.error && <p role='alert' class='mb-4 text-error'>{persistence.error}</p>}
      {persistence.errors.length > 0 && (
        <ul class='mb-4 list-inside list-disc text-error'>
          {persistence.errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}
      <div class='flex flex-wrap justify-end gap-2'>
        <Button data-cancel-draft disabled={saving} onClick={() => finish(false)}>
          {i18n.t('assessments.builder.cancelDraftSwitch')}
        </Button>
        <Button
          disabled={saving}
          onClick={() => {
            current.current.discard?.();
            finish(true);
          }}
        >
          {i18n.t('assessments.builder.discardDraft')}
        </Button>
        <Button
          variant='primary'
          disabled={!persistence.canSave || saving}
          onClick={uiEvent(async () => {
            continuingSave.current = true;
            const saved = await persistence.save();
            continuingSave.current = false;
            if (saved) finish(true);
          })}
        >
          {saving ? i18n.t('editor.saving') : i18n.t('assessments.builder.saveAndContinue')}
        </Button>
      </div>
    </Modal>
  );
}
