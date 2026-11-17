import type { QtiTranscodeDiagnostic } from '@longsightgroup/qti3-transcoder';
import type { AssessmentExportDocument } from './assessment.ts';
import type {
  SelectableAssessmentExportTarget,
  SelectableAssessmentExportTargetId,
} from './assessment_export_targets.ts';

// These are the pinned package serializers' wire contracts, not claims that an LMS
// enforces imported delivery controls. Real product-import evidence is recorded separately.
const PART_REPRESENTATIONS = {
  'qti3-conformant': 'canonical',
  'qti21-standard': 'test-parts',
  'qti22-standard': 'test-parts',
  'blackboard-question-banks': 'test-parts',
  'brightspace-course-import': 'test-parts',
  'qti12-standard': 'section-groups',
  'canvas-classic': 'questions-only',
  'canvas-new-quizzes': 'questions-only',
  'moodle': 'questions-only',
} as const satisfies Readonly<
  Record<
    SelectableAssessmentExportTargetId,
    'canonical' | 'test-parts' | 'section-groups' | 'questions-only'
  >
>;

/** Disclose authored part options that the selected package serializer does not emit. */
export function assessmentExportSettingsDiagnostics(
  document: AssessmentExportDocument,
  target: SelectableAssessmentExportTarget,
): readonly QtiTranscodeDiagnostic[] {
  const representation = PART_REPRESENTATIONS[target.id];
  if (representation === 'canonical') return [];
  const diagnostics: QtiTranscodeDiagnostic[] = [];
  if (representation !== 'test-parts' && document.parts.length > 1) {
    diagnostics.push({
      code: 'qflow.export.part_structure_omitted',
      severity: 'warning',
      message: 'The export retains all questions but omits their test-part delivery boundaries.',
      path: 'assessment.xml',
    });
  }
  for (const [index, part] of document.parts.entries()) {
    const options = part.options;
    const path = `assessment.xml/qti-assessment-test/qti-test-part[${index + 1}]`;
    const add = (setting: string, message: string) => {
      diagnostics.push({
        code: `qflow.export.part_${setting}_omitted`,
        severity: 'warning',
        message,
        path,
      });
    };
    for (const [position, placement] of part.placements.entries()) {
      if (!('content' in placement)) continue;
      diagnostics.push({
        code: `qflow.export.standalone_${placement.content.kind.replace('-', '_')}_omitted`,
        severity: 'warning',
        message: `The unscored ${placement.content.kind} block at position ${
          position + 1
        } in part ${
          index + 1
        } is omitted. All questions are retained. Use the native QTI 3 package to retain this block and its accessibility content.`,
        path: `${path}/content[${placement.id}]`,
      });
    }
    if (
      part.placements.some((placement) => !('content' in placement) && placement.fixed === true)
    ) {
      add(
        'fixed_positions',
        `Fixed question positions for part ${
          index + 1
        } are omitted. Questions remain in authored order in this export.`,
      );
    }
    if (!options) continue;
    if (options.shuffleQuestions === true) {
      add(
        'question_shuffle',
        `Question shuffling for part ${
          index + 1
        } is omitted. Questions remain in authored order in this export.`,
      );
    }
    if (options.instructionsHtml?.trim()) {
      add('instructions', `Instructions for part ${index + 1} are omitted from this export.`);
    }
    if (options.feedback?.length) {
      add(
        'feedback',
        `Feedback and its access conditions for part ${index + 1} are omitted from this export.`,
      );
    }
    if (options.answerFeedbackRelease !== undefined) {
      add(
        'answer_feedback_release',
        `Answer feedback release for part ${
          index + 1
        } is not enforced by this export. Configure feedback release in the destination before delivering it to learners, or use the native QTI 3 package with Harbor.`,
      );
    }
    if (representation === 'test-parts') continue;
    if (options.navigationMode !== undefined) {
      add(
        'navigation',
        `The ${options.navigationMode} navigation setting for part ${
          index + 1
        } is omitted from this export.`,
      );
    }
    if (options.submissionMode !== undefined) {
      add(
        'submission',
        `The ${options.submissionMode} submission setting for part ${
          index + 1
        } is omitted from this export.`,
      );
    }
    if (options.timeLimits?.minTime !== undefined || options.timeLimits?.maxTime !== undefined) {
      add(
        'time_limits',
        `Minimum and maximum time settings for part ${index + 1} are omitted from this export.`,
      );
    }
  }
  return diagnostics;
}
