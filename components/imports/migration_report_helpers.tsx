import type { MigrationItemRecord, MigrationRunRecord } from '../../lib/import/migration_types.ts';
import type { AssessmentBlueprint } from '../../lib/assessment_blueprint.ts';
import type { QuestionReviewSuggestion } from '../../lib/question_review_types.ts';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { SourceBlock } from '../../lib/conversion/source_model.ts';

const DETERMINISTIC_SUGGESTION_KEYS: Readonly<Record<string, string>> = {
  'ambiguous_stem.multiple_questions': 'imports.suggestion.ambiguous_stem.multiple_questions',
  'ambiguous_stem.short': 'imports.suggestion.ambiguous_stem.short',
  'duplicate_options.normalized_text': 'imports.suggestion.duplicate_options.normalized_text',
  'clueing.correct_option_length': 'imports.suggestion.clueing.correct_option_length',
  'clueing.answer_repeated_in_stem': 'imports.suggestion.clueing.answer_repeated_in_stem',
  'answer_key.conflicting_choice_keys': 'imports.suggestion.answer_key.conflicting_choice_keys',
  'answer_key.single_select_reference': 'imports.suggestion.answer_key.single_select_reference',
  'answer_key.multi_select_reference': 'imports.suggestion.answer_key.multi_select_reference',
  'answer_key.text_entry_empty': 'imports.suggestion.answer_key.text_entry_empty',
  'alignment.blueprint_target_missing': 'imports.suggestion.alignment.blueprint_target_missing',
  'accessibility.missing_alt_text': 'imports.suggestion.accessibility.missing_alt_text',
  'accessibility.invalid_data_ssml': 'imports.suggestion.accessibility.invalid_data_ssml',
  'accessibility.unsupported_a11y_markup':
    'imports.suggestion.accessibility.unsupported_a11y_markup',
  'accessibility.color_only_instruction': 'imports.suggestion.accessibility.color_only_instruction',
  'accessibility.missing_media_label': 'imports.suggestion.accessibility.missing_media_label',
  'accessibility.missing_captions': 'imports.suggestion.accessibility.missing_captions',
  'accessibility.missing_transcript': 'imports.suggestion.accessibility.missing_transcript',
};

export function presentMigrationSuggestion(
  suggestion: QuestionReviewSuggestion,
  item: MigrationItemRecord,
  blueprint: AssessmentBlueprint | null,
  i18n: I18n,
): string {
  if (suggestion.source === 'ai') {
    return i18n.t('imports.report.aiFraming', { message: suggestion.message });
  }
  if (suggestion.code === 'alignment.question_type_mismatch') {
    const target = blueprint?._tag === 'Defined'
      ? blueprint.targets.find((entry) => entry.id === item.blueprintTargetId)
      : undefined;
    if (!target) return i18n.t('imports.suggestion.unknown');
    return i18n.t('imports.report.typeMismatch', {
      expectedType: i18n.t('imports.blueprint.typeLabel', { type: target.questionType }),
      actualType: i18n.t('imports.blueprint.typeLabel', { type: item.importedDraft.type }),
    });
  }
  const key = DETERMINISTIC_SUGGESTION_KEYS[suggestion.code];
  return key ? i18n.t(key) : i18n.t('imports.suggestion.unknown');
}

export function itemVersionToken(item: MigrationItemRecord): string {
  return `${item.contentHash}:${item.contextHash}:${item.decision}`;
}

export function qaReportFilename(run: MigrationRunRecord): string {
  return `${
    run.sourceFilename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
      .toLowerCase() || 'conversion'
  }-qa-report.md`;
}

export function ReadinessBadge(
  { readiness, i18n }: { readiness: MigrationItemRecord['readiness']; i18n: I18n },
) {
  const classes = readiness === 'ready'
    ? 'ds-badge-success'
    : readiness === 'blocked'
    ? 'ds-badge-error'
    : 'ds-badge-warning';
  return (
    <span class={`ds-badge ds-badge-outline ${classes}`}>
      {readiness === 'ready'
        ? i18n.t('imports.report.ready')
        : readiness === 'blocked'
        ? i18n.t('imports.report.blocked')
        : readiness === 'minor_review'
        ? i18n.t('imports.report.minorReview')
        : i18n.t('imports.report.majorReview')}
    </span>
  );
}

export function DecisionBadge(
  { decision, i18n }: { decision: MigrationItemRecord['decision']; i18n: I18n },
) {
  const classes = decision === 'accepted'
    ? 'ds-badge-success'
    : decision === 'rejected'
    ? 'ds-badge-ghost'
    : '';
  return (
    <span class={`ds-badge ds-badge-outline ${classes}`}>
      {decision === 'accepted'
        ? i18n.t('imports.report.decisionAccepted')
        : decision === 'rejected'
        ? i18n.t('imports.report.decisionRejected')
        : i18n.t('imports.report.decisionPending')}
    </span>
  );
}

export function Metric({ label, value, i18n }: { label: string; value: number; i18n: I18n }) {
  return (
    <div class='bg-base-100 p-4'>
      <div class='text-xs text-base-content/70'>{label}</div>
      <div class='mt-1 text-2xl font-semibold'>{i18n.formatNumber(value)}</div>
    </div>
  );
}

export function sourceBlockText(block: SourceBlock): string {
  if (block.kind === 'heading' || block.kind === 'paragraph') return block.text;
  if (block.kind === 'list') return block.items.join(' ');
  if (block.kind === 'table') return block.rows.flat().join(' ');
  if (block.kind === 'image') return `${block.alt ?? ''} ${block.source}`;
  if (block.kind === 'equation') return block.expression;
  return `Page ${block.page}`;
}
export function normalizeEvidenceText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function evidenceHrefFor(
  item: MigrationItemRecord,
  sourceBlocks: SourceBlock[],
): string | null {
  const block = item.evidence.find((anchor) => anchor.kind === 'block');
  if (block?.kind === 'block') return `#source-${block.blockId}`;
  const text = item.evidence.find((anchor) => anchor.kind === 'text_range');
  if (text?.kind === 'text_range') {
    const quote = normalizeEvidenceText(text.quote);
    const matched = quote
      ? sourceBlocks.find((candidate) =>
        normalizeEvidenceText(sourceBlockText(candidate)).includes(quote)
      )
      : undefined;
    if (matched) return `#source-${matched.id}`;
  }
  const page = item.evidence.find((anchor) => anchor.kind === 'page');
  if (page?.kind === 'page') {
    const matched = sourceBlocks.find((candidate) => candidate.page === page.page);
    if (matched) return `#source-${matched.id}`;
  }
  const entry = item.evidence.find((anchor) => anchor.kind === 'package_entry');
  if (entry?.kind === 'package_entry') {
    const matched = sourceBlocks.find((candidate) =>
      normalizeEvidenceText(sourceBlockText(candidate)).includes(normalizeEvidenceText(entry.path))
    );
    if (matched) return `#source-${matched.id}`;
  }
  return item.evidence.length ? '#source-heading' : null;
}
