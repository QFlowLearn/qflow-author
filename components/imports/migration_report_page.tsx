import ImportProgressView from '../../islands/ImportProgress.tsx';
import BlueprintPanelView from '../../islands/BlueprintPanel.tsx';
import ConversionGenerationView from '../../islands/ConversionGeneration.tsx';
import { mountIsland } from '../../lib/rendering/mount_island.ts';
import Disclosure from '../ui/Disclosure.tsx';
import { MigrationOutcome } from './migration_outcome.tsx';
import { MigrationCheckSummary } from './migration_check_summary.tsx';
import type { MigrationImportChecks } from '../../lib/import/migration_import_checks.ts';
import { SourceEvidencePanel } from './migration_source_evidence.tsx';
import { MigrationRepeatSummary } from './migration_repeat_summary.tsx';
import type { MigrationExactRepeats } from '../../lib/import/migration_exact_repeats.ts';
import { MigrationReviewNavigation } from './migration_review_navigation.tsx';
import {
  migrationReviewHref,
  type MigrationReviewPagination,
} from '../../lib/import/migration_review_filter.ts';
import { MigrationCommitPanel } from './migration_commit_panel.tsx';
import { migrationCommittedHref } from '../../lib/import/migration_destination.ts';
import Button from '../ui/Button.tsx';
import Checkbox from '../ui/Checkbox.tsx';
import Input from '../ui/Input.tsx';
import Select from '../ui/Select.tsx';
import Textarea from '../ui/Textarea.tsx';
import {
  type MigrationItemRecord,
  type MigrationRunRecord,
} from '../../lib/import/migration_types.ts';
import type { MigrationBatchReviewContext } from '../../lib/import/migration_batches.ts';
import type { MigrationApprovalState } from '../../lib/import/migration_state.ts';
import type { SourceBlock } from '../../lib/conversion/source_model.ts';
import { QUESTION_TYPES } from '../../lib/types/registry.ts';
import { MigrationItemPreview } from './migration_item_preview.tsx';
import type { AssessmentBlueprint } from '../../lib/assessment_blueprint.ts';
import { assessAcceptedMigrationBlueprintCoverage } from '../../lib/import/migration_blueprint_coverage.ts';
import { collectQuestionReviewSuggestions } from '../../lib/question_review.ts';
import type { I18nPayload } from '../../lib/i18n/payload.ts';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { QflowPlayerMessageCatalog } from '../../lib/i18n/player_messages/types.ts';
import {
  DecisionBadge,
  evidenceHrefFor,
  itemVersionToken,
  Metric,
  presentMigrationSuggestion,
  ReadinessBadge,
} from './migration_report_helpers.tsx';
export { presentMigrationSuggestion, qaReportFilename } from './migration_report_helpers.tsx';

export type MigrationReportPageProps = {
  run: MigrationRunRecord;
  pagination?: MigrationReviewPagination;
  exactRepeats?: MigrationExactRepeats;
  importChecks?: MigrationImportChecks;
  commitProgress?: { state: string; completed: number; total: number };
  batch?: MigrationBatchReviewContext;
  currentUserId?: string;
  commitError?: string | null;
  title?: string;
  eyebrow?: string;
  readOnly?: boolean;
  itemHrefBase?: string;
  editItemId?: string | null;
  payload: I18nPayload;
  i18n: I18n;
  playerCatalog: QflowPlayerMessageCatalog;
};

export default function MigrationReportPage({
  run,
  pagination,
  exactRepeats,
  importChecks,
  commitProgress,
  batch,
  currentUserId,
  commitError,
  title,
  readOnly = false,
  editItemId = null,
  payload,
  i18n,
  playerCatalog,
}: MigrationReportPageProps) {
  const active = run.execution._tag === 'Queued' || run.execution._tag === 'Analyzing';
  const reviewable = run.execution._tag === 'Analyzed' || run.execution._tag === 'Committed';
  const frozen = Boolean(commitProgress);
  const normalized = run.artifacts.find((artifact) => artifact.kind === 'normalized');
  const original = run.artifacts.find((artifact) => artifact.kind === 'original');
  const sourceBlocks = normalized?.document?.blocks ?? [];
  const blueprintCoverage =
    run.destination._tag === 'Assessment' && run.destination.blueprint?._tag === 'Defined'
      ? assessAcceptedMigrationBlueprintCoverage(run.destination.blueprint, run.items)
      : undefined;

  return (
    <main class='space-y-6' aria-labelledby='conversion-title'>
      <header class='space-y-3'>
        <div class='flex flex-wrap items-start justify-between gap-4'>
          <div>
            <p class='text-xs font-medium uppercase tracking-wide text-base-content/70'>
              {run.purpose === 'generate_new'
                ? i18n.t('imports.report.generate')
                : i18n.t('imports.report.recover')}
            </p>
            <h1 id='conversion-title' class='mt-1 text-3xl font-semibold tracking-tight'>
              {title ?? i18n.t('imports.report.title')}
            </h1>
            <p class='mt-2 max-w-3xl text-sm leading-6 text-base-content/70'>
              {reviewable && run.reviewProgress.total > 0
                ? i18n.t('imports.report.description')
                : run.sourceFilename}
            </p>
          </div>
          <div class='flex flex-wrap gap-2'>
            {batch && (
              <Button size='sm' variant='ghost' href={`/imports/batches/${batch.id}`}>
                {i18n.t('imports.report.batchProgress')}
              </Button>
            )}
            {original && (
              <Button
                size='sm'
                variant='ghost'
                href={`/imports/${run.id}/artifacts/${original.id}`}
              >
                {i18n.t('imports.report.originalSource')}
              </Button>
            )}
            {normalized && (
              <Button
                size='sm'
                variant='ghost'
                href={`/imports/${run.id}/artifacts/${normalized.id}`}
              >
                {i18n.t('imports.report.normalized')}
              </Button>
            )}
          </div>
        </div>
        {reviewable && run.reviewProgress.total > 0 && (
          <div class='grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-base-300 bg-base-300 sm:grid-cols-4'>
            <Metric
              i18n={i18n}
              label={i18n.t('imports.report.questions')}
              value={run.reviewProgress.total}
            />
            <Metric
              i18n={i18n}
              label={i18n.t('imports.report.accepted')}
              value={run.reviewProgress.accepted}
            />
            <Metric
              i18n={i18n}
              label={i18n.t('imports.report.pending')}
              value={run.reviewProgress.pending}
            />
            <Metric
              i18n={i18n}
              label={i18n.t('imports.report.blocked')}
              value={run.summary.counts.blocked}
            />
          </div>
        )}
      </header>
      {active && (
        <ImportProgressRoot
          runId={run.id}
          state={run.execution._tag === 'Queued' ? 'Queued' : 'Analyzing'}
          payload={payload}
        />
      )}
      <MigrationOutcome run={run} readOnly={readOnly} i18n={i18n} />
      {importChecks && <MigrationCheckSummary runId={run.id} summary={importChecks} i18n={i18n} />}
      {exactRepeats && <MigrationRepeatSummary runId={run.id} summary={exactRepeats} i18n={i18n} />}

      {commitError && <div class='ds-alert ds-alert-error text-sm' role='alert'>{commitError}</div>}

      {reviewable && run.destination._tag === 'Assessment' && run.items.length > 0 && (
        <Disclosure summary={i18n.t('imports.report.editPlan')}>
          <BlueprintPanelRoot
            resource='conversion'
            resourceId={run.id}
            initialBlueprint={run.destination.blueprint}
            coverage={blueprintCoverage}
            readOnly={readOnly || run.execution._tag === 'Committed' ||
              run.reviewProgress.pending !== run.items.length}
            payload={payload}
          />
        </Disclosure>
      )}

      <div class='grid gap-6 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.1fr)] lg:items-start'>
        <SourceEvidencePanel run={run} i18n={i18n} paged={pagination !== undefined} />
        {reviewable &&
          (run.items.length > 0 || run.purpose === 'generate_new' ||
            pagination?.filter === 'blocked') &&
          (
            <section class='min-w-0 space-y-5' aria-labelledby='questions-heading'>
              <div class='flex flex-wrap items-center justify-between gap-3'>
                <div>
                  <h2 id='questions-heading' class='text-xl font-semibold'>
                    {i18n.t('imports.report.questions')}
                  </h2>
                  <p class='mt-1 text-sm text-base-content/65'>
                    {i18n.t('imports.report.approvalIncomplete')}
                  </p>
                </div>
              </div>

              <MigrationReviewNavigation
                pagination={pagination}
                runId={run.id}
                i18n={i18n}
              />

              {run.items.length
                ? (
                  <div class='space-y-4'>
                    {!readOnly && !frozen && <BulkToolbar i18n={i18n} />}
                    <div class='space-y-4'>
                      {run.items.map((item) => (
                        <ReviewCard
                          key={item.id}
                          item={item}
                          sourceBlocks={sourceBlocks}
                          readOnly={readOnly || frozen}
                          editorOpen={editItemId === item.id}
                          editorReviewHref={migrationReviewHref(
                            run.id,
                            pagination?.page ?? 1,
                            pagination?.filter ?? 'all',
                            item.id,
                          )}
                          assessmentId={run.execution._tag === 'Committed' &&
                              run.execution.destination._tag === 'Assessment'
                            ? run.execution.destination.assessmentId
                            : undefined}
                          blueprint={run.destination._tag === 'Assessment'
                            ? run.destination.blueprint
                            : null}
                          i18n={i18n}
                          payload={payload}
                          playerCatalog={playerCatalog}
                        />
                      ))}
                    </div>
                  </div>
                )
                : pagination?.filter === 'blocked'
                ? <p role='status'>{i18n.t('imports.report.noBlockedQuestions')}</p>
                : run.purpose === 'generate_new'
                ? (
                  <div class='rounded-lg border border-dashed border-base-300 p-8 text-center'>
                    <h3 class='font-medium'>
                      {run.purpose === 'generate_new'
                        ? i18n.t('imports.report.sourcePreserved')
                        : i18n.t('imports.report.noQuestions')}
                    </h3>
                    <p class='mx-auto mt-2 max-w-md text-sm leading-6 text-base-content/65'>
                      {run.purpose === 'generate_new'
                        ? i18n.t('imports.report.emptyGenerateHelp')
                        : i18n.t('imports.report.emptyRecoverHelp')}
                    </p>
                    {run.destination._tag === 'Assessment' && run.purpose === 'generate_new' &&
                      !readOnly && (
                      <div class='mt-6'>
                        <ConversionGenerationRoot
                          runId={run.id}
                          initialBlueprint={run.destination.blueprint}
                          payload={payload}
                        />
                      </div>
                    )}
                  </div>
                )
                : null}
            </section>
          )}
      </div>

      {!readOnly && run.reviewProgress.total > 0 && run.purpose === 'recover_existing' &&
        run.execution._tag === 'Analyzed' && batch && (
        <ApprovalStage
          run={run}
          batch={batch}
          currentUserId={currentUserId}
          i18n={i18n}
        />
      )}

      <MigrationCommitPanel
        run={run}
        readOnly={readOnly}
        commitProgress={commitProgress}
        i18n={i18n}
      />

      {run.execution._tag === 'Committed' && (
        <div class='ds-alert ds-alert-success'>
          <span>
            {i18n.t(
              run.execution.destination._tag === 'WorkspaceBank'
                ? 'imports.report.addedToBank'
                : 'imports.report.committed',
            )}
          </span>
          {run.execution.destination._tag === 'WorkspaceBank' && (
            <span>{i18n.t('imports.report.bankReleaseNotice')}</span>
          )}
          <Button href={migrationCommittedHref(run.execution.destination)} size='sm'>
            {i18n.t(
              run.execution.destination._tag === 'WorkspaceBank'
                ? 'imports.report.openBank'
                : 'imports.report.openAssessment',
            )}
          </Button>
        </div>
      )}
    </main>
  );
}

function ApprovalStage({
  run,
  batch,
  currentUserId,
  i18n,
}: {
  run: MigrationRunRecord;
  batch: MigrationBatchReviewContext;
  currentUserId?: string;
  i18n: I18n;
}) {
  const reviewer = batch.assignedReviewerName || batch.assignedReviewerEmail;
  const isReviewer = Boolean(
    currentUserId && batch.assignedReviewerId === currentUserId,
  );
  const reviewComplete = run.reviewProgress.total > 0 &&
    run.reviewProgress.pending === 0 &&
    run.reviewProgress.accepted > 0;
  return (
    <section
      class='rounded-lg border border-base-300 bg-base-100 p-5'
      aria-labelledby='approval-heading'
    >
      <div class='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 id='approval-heading' class='text-lg font-semibold'>
            {i18n.t('imports.report.approval')}
          </h2>
          <p class='mt-1 text-sm leading-6 text-base-content/65'>
            {reviewer
              ? i18n.t('imports.report.reviewerPresent', { reviewer })
              : i18n.t('imports.report.reviewerAbsent')}
          </p>
        </div>
        <span class='ds-badge ds-badge-outline'>{approvalLabel(run.approval, i18n)}</span>
      </div>

      {run.approval._tag === 'ChangesRequested' && (
        <div class='mt-4 ds-alert ds-alert-warning text-sm' role='status'>
          <div>
            <p class='font-medium'>{i18n.t('imports.report.changesNeeded')}</p>
            <p class='mt-1'>{run.approval.note}</p>
          </div>
        </div>
      )}

      {(run.approval._tag === 'Draft' || run.approval._tag === 'ChangesRequested') && (
        <form method='post' class='mt-4'>
          <input type='hidden' name='action' value='submit-approval' />
          <Button
            type='submit'
            variant='primary'
            disabled={!batch.assignedReviewerId || !reviewComplete}
          >
            {i18n.t('imports.report.submit')}
          </Button>
          {!reviewComplete && (
            <p class='mt-2 text-sm text-base-content/65'>
              {i18n.t('imports.report.approvalIncomplete')}
            </p>
          )}
        </form>
      )}

      {run.approval._tag === 'Submitted' && !isReviewer && (
        <p class='mt-4 text-sm text-base-content/65'>
          {i18n.t('imports.report.approvalWaiting')}
        </p>
      )}

      {run.approval._tag === 'Submitted' && isReviewer && (
        <div class='mt-4 grid gap-4 md:grid-cols-2'>
          <form method='post' class='rounded-md border border-success/40 p-4'>
            <input type='hidden' name='action' value='approve' />
            <p class='text-sm leading-6'>
              {i18n.t('imports.report.approvalConfirmEvidence')}
            </p>
            <Button type='submit' variant='primary' class='mt-3'>
              {i18n.t('imports.report.approve')}
            </Button>
          </form>
          <form method='post' class='rounded-md border border-warning/40 p-4'>
            <input type='hidden' name='action' value='request-changes' />
            <label class='text-sm font-medium' for='approval-note'>
              {i18n.t('imports.report.changesNeeded')}
            </label>
            <Textarea id='approval-note' name='approvalNote' rows={3} required class='mt-2' />
            <Button type='submit' class='mt-3'>{i18n.t('imports.report.requestChanges')}</Button>
          </form>
        </div>
      )}

      {run.approval._tag === 'Approved' && (
        <div class='mt-4 ds-alert ds-alert-success text-sm' role='status'>
          {i18n.t('imports.report.approvalApprovedSuccess')}
        </div>
      )}
    </section>
  );
}

function approvalLabel(state: MigrationApprovalState, i18n: I18n): string {
  if (state._tag === 'Draft') return i18n.t('imports.report.approvalDraft');
  if (state._tag === 'Submitted') return i18n.t('imports.report.approvalSubmitted');
  if (state._tag === 'Approved') return i18n.t('imports.report.approvalApproved');
  return i18n.t('imports.report.approvalChangesRequested');
}

function BulkToolbar({ i18n }: { i18n: I18n }) {
  return (
    <form
      id='conversion-bulk-actions'
      method='post'
      class='space-y-3 rounded-lg border border-base-300 bg-base-100 p-4'
    >
      <input type='hidden' name='action' value='bulk' />
      <div class='flex flex-wrap gap-2'>
        <Button type='submit' name='bulkAction' value='accept' size='sm'>
          {i18n.t('imports.report.acceptSelected')}
        </Button>
        <Button type='submit' name='bulkAction' value='reject' size='sm' variant='ghost'>
          {i18n.t('imports.report.rejectSelected')}
        </Button>
      </div>
      <div class='grid gap-3 sm:grid-cols-2'>
        <label class='ds-form-control gap-1'>
          <span class='text-xs font-medium'>{i18n.t('imports.report.tags')}</span>
          <div class='flex gap-2'>
            <Input name='tags' size='sm' />
            <Button type='submit' name='bulkAction' value='retag' size='sm'>
              {i18n.t('imports.report.retag')}
            </Button>
          </div>
        </label>
        <label class='ds-form-control gap-1'>
          <span class='text-xs font-medium'>{i18n.t('imports.report.questionType')}</span>
          <div class='flex gap-2'>
            <Select name='typeId' size='sm'>
              {QUESTION_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {i18n.t('imports.blueprint.typeLabel', { type: type.id })}
                </option>
              ))}
            </Select>
            <Button type='submit' name='bulkAction' value='change_type' size='sm'>
              {i18n.t('imports.report.change')}
            </Button>
          </div>
        </label>
      </div>
    </form>
  );
}

function ReviewCard({
  item,
  sourceBlocks,
  readOnly,
  editorOpen,
  editorReviewHref,
  assessmentId,
  blueprint,
  i18n,
  payload,
  playerCatalog,
}: {
  item: MigrationItemRecord;
  sourceBlocks: SourceBlock[];
  readOnly: boolean;
  editorOpen: boolean;
  editorReviewHref: string;
  assessmentId?: string | null;
  blueprint: AssessmentBlueprint | null;
  i18n: I18n;
  payload: I18nPayload;
  playerCatalog: QflowPlayerMessageCatalog;
}) {
  const evidenceHref = evidenceHrefFor(item, sourceBlocks);
  const editorHref = item.createdQuestionId
    ? `/items/${item.createdQuestionId}`
    : assessmentId
    ? `/assessments/${assessmentId}`
    : editorReviewHref;
  const reviewSuggestions = collectQuestionReviewSuggestions(item.importedDraft, {
    ...(blueprint === null ? {} : { blueprint }),
    blueprintTargetId: item.blueprintTargetId ?? undefined,
    aiSuggestions: item.reviewSuggestions,
  });
  return (
    <article
      id={`item-${item.id}`}
      class='scroll-mt-4 rounded-lg border border-base-300 bg-base-100'
    >
      <div class='flex flex-wrap items-start gap-3 p-4'>
        {!readOnly && (
          <>
            <Checkbox
              name='itemId'
              value={item.id}
              form='conversion-bulk-actions'
              aria-label={i18n.t('imports.report.selection', { title: item.title })}
            />
            <input
              type='hidden'
              name={`itemVersion:${item.id}`}
              value={itemVersionToken(item)}
              form='conversion-bulk-actions'
            />
          </>
        )}
        <div class='min-w-0 flex-1'>
          <div class='flex flex-wrap items-center gap-2'>
            <h3 class='font-semibold'>{item.title}</h3>
            <ReadinessBadge readiness={item.readiness} i18n={i18n} />
            <DecisionBadge decision={item.decision} i18n={i18n} />
          </div>
          <p class='mt-1 text-xs text-base-content/70'>
            {i18n.t('imports.blueprint.typeLabel', { type: item.importedDraft.type })}
          </p>
        </div>
        <div class='flex flex-wrap gap-3'>
          {evidenceHref && (
            <a class='ds-link text-sm' href={evidenceHref}>
              {i18n.t('imports.report.viewEvidence')}
            </a>
          )}
          {!readOnly && (
            <a class='ds-link text-sm' href={editorHref}>{i18n.t('imports.report.openEditor')}</a>
          )}
        </div>
      </div>
      <details class='border-t border-base-200' open={editorOpen || undefined}>
        <summary class='min-h-12 cursor-pointer px-4 py-3 text-sm font-medium'>
          {readOnly
            ? i18n.t('imports.report.previewDetails')
            : i18n.t('imports.report.previewEdit')}
        </summary>
        <div class='grid gap-5 border-t border-base-200 p-4 xl:grid-cols-2'>
          <MigrationItemPreview
            item={item}
            i18n={i18n}
            payload={payload}
            playerCatalog={playerCatalog}
          />
          <div class='space-y-4'>
            {!readOnly && (
              <form method='post' class='space-y-3' id={`editor-${item.id}`}>
                <input type='hidden' name='action' value='edit-item' />
                <input type='hidden' name='itemId' value={item.id} />
                <input
                  type='hidden'
                  name={`itemVersion:${item.id}`}
                  value={itemVersionToken(item)}
                />
                <label class='ds-form-control gap-1'>
                  <span class='text-xs font-medium'>{i18n.t('imports.report.titleLabel')}</span>
                  <Input name='title' value={item.title} />
                </label>
                <label class='ds-form-control gap-1'>
                  <span class='text-xs font-medium'>{i18n.t('imports.report.bodyLabel')}</span>
                  <Textarea
                    name='bodyHtml'
                    rows={6}
                    value={String(
                      item.importedDraft.bodyHtml ?? item.importedDraft.promptHtml ?? '',
                    )}
                  />
                </label>
                <Button type='submit' size='sm'>{i18n.t('imports.report.save')}</Button>
              </form>
            )}
            {!readOnly && blueprint?._tag === 'Defined' && (
              <form method='post' class='space-y-2'>
                <input type='hidden' name='action' value='align-item' />
                <input type='hidden' name='itemId' value={item.id} />
                <input
                  type='hidden'
                  name={`itemVersion:${item.id}`}
                  value={itemVersionToken(item)}
                />
                <label class='ds-form-control gap-1'>
                  <span class='text-xs font-medium'>
                    {i18n.t('imports.report.blueprintTarget')}
                  </span>
                  <Select
                    name='blueprintTargetId'
                    value={item.blueprintTargetId ?? ''}
                    required
                  >
                    <option value='' disabled>{i18n.t('imports.report.chooseTarget')}</option>
                    {blueprint.targets.filter((target) => target.questionType === item.itemType)
                      .map(
                        (target) => {
                          const outcome = blueprint.outcomes.find((entry) =>
                            entry.id === target.outcomeId
                          );
                          return (
                            <option key={target.id} value={target.id}>
                              {outcome?.title ?? i18n.t('imports.blueprint.unknownOutcome')} ·{' '}
                              {i18n.t('imports.blueprint.demandLabel', {
                                value: target.cognitiveDemand,
                              })} · {i18n.t('imports.blueprint.difficultyLabel', {
                                value: target.difficulty,
                              })}
                            </option>
                          );
                        },
                      )}
                  </Select>
                </label>
                <Button type='submit' size='sm'>{i18n.t('imports.report.align')}</Button>
              </form>
            )}
            {!readOnly && blueprint?._tag === 'Unspecified' && (
              <p class='rounded-md border border-warning/40 bg-warning/10 p-3 text-sm'>
                {i18n.t('imports.report.defineBlueprintBeforeAlign')}
              </p>
            )}
            {reviewSuggestions.length > 0 && (
              <div class='space-y-2 rounded-md border border-base-300 p-3'>
                <h4 class='text-sm font-medium'>{i18n.t('imports.report.suggestions')}</h4>
                <ul class='space-y-2 text-sm'>
                  {reviewSuggestions.map((suggestion) => (
                    <li key={`${suggestion.source}:${suggestion.code}`} class='flex gap-2'>
                      <span class='ds-badge ds-badge-outline ds-badge-sm shrink-0'>
                        {suggestion.source === 'ai'
                          ? i18n.t('imports.report.aiSuggestion')
                          : i18n.t('imports.report.checkSuggestion')}
                      </span>
                      <span>{presentMigrationSuggestion(suggestion, item, blueprint, i18n)}</span>
                    </li>
                  ))}
                </ul>
                <p class='text-xs leading-5 text-base-content/60'>
                  {i18n.t('imports.report.suggestionsHelp')}
                </p>
              </div>
            )}
            {item.warnings.length > 0 && (
              <div class='space-y-1'>
                <h5 class='text-xs font-medium text-warning-content'>
                  {i18n.t('imports.report.previewIssues')}
                </h5>
                <p class='text-xs text-warning-content/80'>
                  {i18n.t('imports.report.rawDiagnostic')}
                </p>
                <ul class='list-disc space-y-1 pl-5 text-xs text-warning-content'>
                  {item.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${index}`}>{warning.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </details>
    </article>
  );
}

const ImportProgressRoot = mountIsland({ component: 'ImportProgress', View: ImportProgressView });
const BlueprintPanelRoot = mountIsland({ component: 'BlueprintPanel', View: BlueprintPanelView });
const ConversionGenerationRoot = mountIsland({
  component: 'ConversionGeneration',
  View: ConversionGenerationView,
});
