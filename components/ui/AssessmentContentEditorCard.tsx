import { uiEvent } from '../../lib/client/ui_event.ts';
import { useEffect, useRef } from 'preact/hooks';
import Button from './Button.tsx';
import type { ComponentChildren } from 'preact';
import QuestionPersistenceNotice from './QuestionPersistenceNotice.tsx';

/** One content-editor frame owns save, recovery and structural actions. */
export default function AssessmentContentEditorCard(props: {
  readonly children: ComponentChildren;
  readonly title: string;

  readonly saveLabel: string;
  readonly cancelLabel: string;
  readonly message: string;
  readonly error: string | null;
  readonly errorId: string;
  readonly busy: boolean;
  readonly frozen: boolean;
  readonly structuralActions: boolean;
  readonly duplicateLabel: string;
  readonly removeLabel: string;
  readonly onDuplicate: () => Promise<unknown>;
  readonly onRemove: () => Promise<unknown>;
  readonly canSave: boolean;
  readonly saved: boolean;
  readonly retryLabel?: string;
  readonly reloadLabel?: string;
  readonly action: string;
  readonly onSave: () => Promise<unknown>;
  readonly onClose: () => Promise<unknown>;
  readonly onReload: () => Promise<unknown>;
}) {
  const article = useRef<HTMLElement | null>(null);
  useEffect(
    () =>
      article.current?.querySelector<HTMLElement>('textarea, input:not([type=file]), button')
        ?.focus(),
    [],
  );
  return (
    <article ref={article} class='rounded-xl border border-base-300 bg-base-100 p-4 sm:p-5'>
      <h3 class='mb-3 text-sm font-medium text-base-content'>{props.title}</h3>
      <form
        method='post'
        action={props.action}
        onSubmit={uiEvent(async (event) => {
          event.preventDefault();
          await props.onSave();
        })}
      >
        {props.children}
        {props.error && (
          <p id={props.errorId} role='alert' class='mt-3 text-sm text-error'>{props.error}</p>
        )}
        <div class='mt-4 flex flex-wrap items-center gap-3'>
          <Button type='submit' variant='primary' disabled={!props.canSave}>
            {props.saveLabel}
          </Button>
          <Button type='button' disabled={props.busy} onClick={uiEvent(props.onClose)}>
            {props.cancelLabel}
          </Button>
          {props.structuralActions && (
            <>
              <Button type='button' disabled={props.busy} onClick={uiEvent(props.onDuplicate)}>
                {props.duplicateLabel}
              </Button>
              <Button type='button' disabled={props.busy} onClick={uiEvent(props.onRemove)}>
                {props.removeLabel}
              </Button>
            </>
          )}
          {props.retryLabel && (
            <Button
              type='button'
              onClick={uiEvent(async () => {
                await props.onSave();
              })}
            >
              {props.retryLabel}
            </Button>
          )}
          {props.reloadLabel && (
            <Button type='button' onClick={uiEvent(props.onReload)}>{props.reloadLabel}</Button>
          )}
          <QuestionPersistenceNotice
            message={props.message}
            tone={props.saved ? 'success' : props.error ? 'warning' : 'neutral'}
          />
        </div>
      </form>
    </article>
  );
}
