import { useDomId } from '../../lib/rendering/island_context.tsx';

import QuestionPointsField from '../ui/QuestionPointsField.tsx';
import { useItemEditorState } from '../../islands/item_editor/context.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

/** One canonical point field shared by single-answer and multiple-answer choice editors. */
export default function QuestionPoints() {
  const id = useDomId();
  const i18n = useI18n();
  const { content, persistence } = useItemEditorState();
  const points = content.points;
  return (
    <QuestionPointsField
      id={id}
      label={i18n.t('driver.points.label')}
      value={points.text}
      help={points.templateHelp}
      helpLabel={i18n.t('driver.points.help')}
      notice={points.visibleIssue ? null : points.message}
      issue={points.visibleIssue ?? (persistence.fieldHasIssue('maximumScore')
        ? persistence.fieldIssueText('maximumScore') ?? null
        : null)}
      readOnly={points.readOnly}
      onInput={points.change}
      onBlur={points.blur}
    />
  );
}
