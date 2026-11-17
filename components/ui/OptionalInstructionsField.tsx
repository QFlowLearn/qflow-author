import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import Button from './Button.tsx';
import Textarea from './Textarea.tsx';
import { FieldIssueMessage } from './Input.tsx';

/** Reveal empty instructions on request while keeping authored content and errors visible. */
export default function OptionalInstructionsField(props: {
  readonly id: string;
  readonly label: string;
  readonly addLabel: string;
  readonly value: string;
  readonly placeholder: string;
  readonly issue: string | undefined;
  readonly onInput: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);
  if (!editing && !props.value.trim() && !props.issue) {
    return (
      <Button
        type='button'
        variant='text'
        data-editor-field='prompt'
        onClick={() => setEditing(true)}
      >
        {props.addLabel}
      </Button>
    );
  }
  return (
    <div class='space-y-1'>
      <label for={props.id} class='block text-sm text-base-content/80'>{props.label}</label>
      <Textarea
        id={props.id}
        textareaRef={field}
        data-editor-field='prompt'
        rows={1}
        autoSize
        appearance='quiet'
        value={props.value}
        placeholder={props.placeholder}
        aria-invalid={props.issue ? true : undefined}
        aria-describedby={props.issue ? `${props.id}-issue` : undefined}
        onInput={(event) => {
          setEditing(true);
          props.onInput(event.currentTarget.value);
        }}
      />
      {props.issue && <FieldIssueMessage id={`${props.id}-issue`} message={props.issue} />}
    </div>
  );
}
