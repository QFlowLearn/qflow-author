import type { QuestionBankPage } from '../../lib/services/question_bank_read.ts';
import {
  listSelectableAssessmentExportTargets,
  type SelectableAssessmentExportTargetId,
} from '../../lib/export/assessment_export_targets.ts';
import type { I18n } from '../../lib/i18n/messages.ts';

export function CompatibilitySummary(props: {
  readonly compatibility: QuestionBankPage['items'][number]['compatibility'];
  readonly selectedTarget?: SelectableAssessmentExportTargetId;
  readonly targets: QuestionBankPage['facets']['targets'];
  readonly i18n: I18n;
}) {
  if (props.selectedTarget) {
    const target = props.targets.find((candidate) => candidate.id === props.selectedTarget);
    if (!target) throw new Error('Selected export target is not registered.');
    const result = props.compatibility.find((candidate) =>
      candidate.targetId === props.selectedTarget
    );
    if (!result) throw new Error('Selected export target projection is missing.');
    return (
      <div class='text-xs'>
        <p class='font-medium'>{exportTargetLabel(target.id, props.i18n)}</p>
        <p class='mt-1 text-base-content/80'>
          {props.i18n.t('items.compatibility.selected', { outcome: result.outcome })}
        </p>
      </div>
    );
  }
  const counts = Object.groupBy(props.compatibility, (entry) => entry.outcome);
  return (
    <details class='text-xs'>
      <summary class='min-h-11 cursor-pointer py-3 font-medium'>
        {props.i18n.t('items.compatibility.exportProfiles')}
      </summary>
      <p class='mt-1 text-base-content/80'>
        {props.i18n.t('items.compatibility.summary', {
          exactCount: counts.exact?.length ?? 0,
          normalizedCount: counts.normalized?.length ?? 0,
          attentionCount: (counts.lossy?.length ?? 0) + (counts.blocked?.length ?? 0),
        })}
      </p>
    </details>
  );
}

/** Formats a registered export target through the request-scoped catalog. */
export function exportTargetLabel(
  targetId: SelectableAssessmentExportTargetId,
  i18n: I18n,
): string {
  const target = listSelectableAssessmentExportTargets().find((candidate) =>
    candidate.id === targetId
  );
  if (!target) throw new Error('Export target is not registered.');
  const targetKey: Record<SelectableAssessmentExportTargetId, string> = {
    'canvas-classic': 'canvas_classic',
    'canvas-new-quizzes': 'canvas_new_quizzes',
    'blackboard-question-banks': 'blackboard_question_banks',
    'brightspace-course-import': 'brightspace_course_import',
    moodle: 'moodle',
    'qti3-conformant': 'qti3_conformant',
    'qti22-standard': 'qti22_standard',
    'qti21-standard': 'qti21_standard',
    'qti12-standard': 'qti12_standard',
  };
  return i18n.t('items.detail.exportTarget', { target: targetKey[target.id] });
}
