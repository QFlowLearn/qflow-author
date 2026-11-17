import Input, { FieldIssueMessage } from './Input.tsx';

/** Server-rendered instructor policy input retains rejected spelling for correction. */
export default function NewQuestionPointsPreference(props: {
  readonly value: string;
  readonly label: string;
  readonly help: string;
  readonly unsetHelp: string;
  readonly issue?: string;
}) {
  const id = 'new-question-points';
  return (
    <div class='space-y-2'>
      <label for={id} class='block text-sm font-medium'>{props.label}</label>
      <Input
        id={id}
        name='maximumScore'
        type='text'
        inputMode='decimal'
        defaultValue={props.value}
        aria-invalid={props.issue ? true : undefined}
        aria-describedby={`${id}-help${props.issue ? ` ${id}-issue` : ''}`}
      />
      <div id={`${id}-help`} class='space-y-1 text-sm text-base-content/70'>
        <p>{props.help}</p>
        <p>{props.unsetHelp}</p>
      </div>
      {props.issue && <FieldIssueMessage id={`${id}-issue`} message={props.issue} />}
    </div>
  );
}
