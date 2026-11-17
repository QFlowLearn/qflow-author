/** A compact, announced persistence message beside the active canvas save action. */
export default function QuestionPersistenceNotice(props: {
  readonly message: string;
  readonly tone: 'neutral' | 'warning' | 'success';
}) {
  const badge = props.tone === 'warning'
    ? 'ds-badge ds-badge-warning ds-badge-sm'
    : 'text-sm text-base-content/75';
  return (
    <span role='status' aria-live='polite' aria-atomic='true' class={`self-center ${badge}`}>
      {props.message}
    </span>
  );
}
