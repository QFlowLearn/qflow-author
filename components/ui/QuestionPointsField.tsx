import Input, { FieldIssueMessage } from './Input.tsx';

/** Compact scoring input beside the first-pass answer controls. */
export default function QuestionPointsField(props: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly help: string | null;
  readonly helpLabel: string;
  readonly notice: string | null;
  readonly issue: string | null;
  readonly readOnly: boolean;
  readonly onInput: (value: string) => void;
  readonly onBlur: () => void;
}) {
  return (
    <div class='space-y-2' data-editor-field='maximumScore'>
      <div class='flex flex-wrap items-start gap-x-3 gap-y-2'>
        <label for={props.id} class='inline-flex min-h-8 items-center text-sm font-medium'>
          {props.label}
        </label>
        <div class='w-28'>
          <Input
            id={props.id}
            size='sm'
            type='text'
            inputMode='decimal'
            value={props.value}
            readOnly={props.readOnly}
            aria-invalid={props.issue ? true : undefined}
            aria-describedby={[
              props.help ? `${props.id}-help` : '',
              props.notice ? `${props.id}-notice` : '',
              props.issue ? `${props.id}-issue` : '',
            ].filter((id) => id !== '').join(' ') || undefined}
            onInput={(event) => props.onInput(event.currentTarget.value)}
            onBlur={props.onBlur}
          />
        </div>
        {props.help && (
          <details class='min-w-0 text-sm text-base-content/80'>
            <summary class='min-h-8 cursor-pointer content-center rounded px-1 underline decoration-base-content/40 underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary'>
              {props.helpLabel}
            </summary>
            <p id={`${props.id}-help`} class='max-w-prose py-2'>{props.help}</p>
          </details>
        )}
      </div>
      {props.notice && (
        <p id={`${props.id}-notice`} class='text-sm text-base-content/80'>{props.notice}</p>
      )}
      {props.issue && <FieldIssueMessage id={`${props.id}-issue`} message={props.issue} />}
    </div>
  );
}
