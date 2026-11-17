import AssessmentContentBlock from '../../components/ui/AssessmentContentBlock.tsx';
import DeferredAssessmentContentEditor from '../../components/assessment_builder/DeferredAssessmentContentEditor.tsx';
import type { AssessmentContentEditorProps } from '../../components/assessment_builder/AssessmentContentEditor.tsx';
import type { AssessmentContentPlacement } from '../../lib/assessment_standalone_content.ts';
import { assessmentQuestionPlacements } from '../../lib/assessment_content.ts';
import { type ComponentChildren, Fragment } from 'preact';
import Button from '../../components/ui/Button.tsx';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import DeferredItemEditorCanvas from './DeferredItemEditorCanvas.tsx';
import type { AuthoringState, ItemActionBusy, ItemMeta, Part } from './types.ts';
import type { EditingQuestionPresentation } from './useAssessmentEditing.ts';
import AssessmentQuestionPreview from './AssessmentQuestionPreview.tsx';
import { ActiveQuestionCard } from './ActiveQuestionCard.tsx';
import { useHydrated } from '../../lib/client/use_hydrated.ts';
import { EDITOR_CARD } from './ui_constants.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import QuestionMoveTools from '../../components/ui/QuestionMoveTools.tsx';
import QuestionOrderNotice from '../../components/ui/QuestionOrderNotice.tsx';
import QuestionMoveTarget from '../../components/ui/QuestionMoveTarget.tsx';
import AssessmentCanvasMoveNotice from '../../components/assessment_builder/AssessmentCanvasMoveNotice.tsx';
import { useAssessmentCanvasDrag } from '../../components/assessment_builder/useAssessmentCanvasDrag.ts';
import type { useAssessmentCanvasMove } from '../../components/assessment_builder/useAssessmentCanvasMove.ts';
import { assessmentCanvasMoveBounds } from '../../lib/assessment_canvas_move.ts';

export type AssessmentCanvasProps = {
  authoringState: AuthoringState;
  editingPresentation: EditingQuestionPresentation | null;
  actionBusy: ItemActionBusy;
  parts: Part[];
  itemMeta: Record<string, ItemMeta>;
  inspectorOpen: boolean;
  onEditItem: (
    itemId: string,
    placementId: string,
    partId: string,
    revision: number,
  ) => void;
  onOpenInspector: (trigger: HTMLElement) => void;
  onAddQuestion: (partId: string, beforePlacementId?: string, trigger?: HTMLElement) => void;
  onCreateVariant: (targetType?: QuestionTypeId) => void;
  onExportXml: () => void;
  onDelete: () => void;
  movement?: ReturnType<typeof useAssessmentCanvasMove>;
  onReloadSavedOrder?: () => Promise<unknown>;
  contentEditor?: Omit<AssessmentContentEditorProps, 'editing'>;
  onEditContent?: (
    partId: string,
    placement: AssessmentContentPlacement,
  ) => void | Promise<unknown>;
};

function EditorShell(
  { children, loadingLabel }: { children: ComponentChildren; loadingLabel: string },
) {
  const hydrated = useHydrated();
  if (!hydrated) {
    return (
      <div class={`${EDITOR_CARD} grid min-h-[240px] place-items-center text-base-content/60`}>
        <div>{loadingLabel}</div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function AssessmentCanvas(props: AssessmentCanvasProps) {
  const i18n = useI18n();
  const questionCount = props.parts.reduce(
    (total, part) => total + assessmentQuestionPlacements(part.placements).length,
    0,
  );
  const movementBlocked = !props.movement || props.movement.blocked || props.actionBusy !== null ||
    props.authoringState._tag === 'Creating' || props.authoringState._tag === 'EditingContent' ||
    props.authoringState._tag === 'CreatingContent';
  const moveBounds = new Map(
    props.parts.map((part) => [part.id, assessmentCanvasMoveBounds(part)]),
  );
  const drag = useAssessmentCanvasDrag(movementBlocked, async (move) => {
    await props.movement?.move(move);
  });
  function moveTools(part: Part, index: number, number: string) {
    const movement = props.movement;
    if (!movement) return null;
    const placement = part.placements[index];
    const bounds = moveBounds.get(part.id)?.get(placement.id);
    if (!bounds) throw new Error('Missing canvas move bounds for a saved placement.');
    return (
      <QuestionMoveTools
        id={`move-question-${placement.id}`}
        position={index}
        bounds={bounds}
        disabled={movementBlocked || bounds.first === bounds.last}
        labels={{
          handle: i18n.t('assessments.builder.moveQuestion', { number }),
          hint: i18n.t('assessments.builder.moveHint'),
          up: i18n.t('assessments.arrange.moveUp'),
          down: i18n.t('assessments.arrange.moveDown'),
          first: i18n.t('assessments.builder.moveFirst'),
          last: i18n.t('assessments.builder.moveLast'),
        }}
        onMove={(position) =>
          movement.move({ partId: part.id, placementId: placement.id, position })}
        onDragStart={(event) => drag.start(part, placement, event)}
        onDragEnd={drag.end}
      />
    );
  }
  function moveTarget(part: Part, index: number, children: ComponentChildren) {
    const placement = part.placements[index];
    return (
      <QuestionMoveTarget
        active={drag.target?.placementId === placement.id}
        label={i18n.t(
          drag.target?.after ? 'assessments.builder.dropAfter' : 'assessments.builder.dropBefore',
        )}
        onDragOver={(event) => drag.over(part, placement, event)}
        onDrop={(event) => drag.drop(part, placement, event)}
      >
        {children}
      </QuestionMoveTarget>
    );
  }

  function renderGap(part: Part, partIndex: number, index: number) {
    const beforePlacementId = part.placements[index]?.id;
    if (
      props.authoringState._tag === 'CreatingContent' && props.authoringState.partId === part.id &&
      props.authoringState.beforePlacementId === beforePlacementId
    ) {
      if (!props.contentEditor) throw new Error('Content editor ownership is missing.');
      return (
        <DeferredAssessmentContentEditor
          key={props.authoringState.placementId}
          editing={props.authoringState}
          {...props.contentEditor}
        />
      );
    }
    if (
      props.authoringState._tag === 'Creating' && props.authoringState.partId === part.id &&
      props.authoringState.beforePlacementId === beforePlacementId
    ) {
      return (
        <EditorShell loadingLabel={i18n.t('editor.loadingControls')}>
          <ActiveQuestionCard
            itemNumber={`${partIndex + 1}.${
              assessmentQuestionPlacements(part.placements.slice(0, index)).length + 1
            }`}
            headerText={i18n.t('assessments.builder.newQuestion', {
              type: localizedQuestionType(i18n, props.authoringState.type),
            })}
            headerType={localizedQuestionType(i18n, props.authoringState.type)}
            questionType={props.authoringState.type}
            inspectorOpen={props.inspectorOpen}
            actionBusy={props.actionBusy}
            onOpenInspector={props.onOpenInspector}
            onCreateVariant={props.onCreateVariant}
            onExportXml={props.onExportXml}
            onDelete={props.onDelete}
          >
            <DeferredItemEditorCanvas
              persistenceStatusLocation={props.inspectorOpen ? 'inspector' : 'canvas'}
            />
          </ActiveQuestionCard>
        </EditorShell>
      );
    }
    return null;
  }

  return (
    <main class='min-w-0 space-y-6'>
      <div class='px-1'>
        <div>
          <h1 class='text-lg font-semibold text-base-content'>
            {i18n.t('assessments.builder.assessmentFlow')}
          </h1>
          <p class='mt-1 text-sm text-base-content/65'>
            {questionCount === 0
              ? i18n.t('assessments.builder.startFirstQuestion')
              : i18n.t('assessments.builder.questionCount', { count: questionCount })}
          </p>
          {props.movement && props.onReloadSavedOrder && (
            <AssessmentCanvasMoveNotice
              status={props.movement.status}
              parts={props.parts}
              items={props.itemMeta}
              i18n={i18n}
              onRetry={props.movement.retry}
              onReload={props.onReloadSavedOrder}
            />
          )}
        </div>
      </div>

      {props.parts.map((part, partIndex) => (
        <section key={part.id} class='space-y-3' aria-labelledby={`part-${part.id}-heading`}>
          <div class='flex items-center gap-3 px-1'>
            <h2
              id={`part-${part.id}-heading`}
              tabIndex={-1}
              class='text-sm font-semibold text-base-content'
            >
              {i18n.t('assessments.builder.partHeading', {
                number: partIndex + 1,
                title: part.title,
              })}
            </h2>
            <span class='text-xs text-base-content/65'>
              {i18n.t('assessments.builder.partQuestionCount', {
                count: assessmentQuestionPlacements(part.placements).length,
              })}
            </span>
          </div>
          {props.movement && part.options?.navigationMode === 'linear' && (
            <QuestionOrderNotice text={i18n.t('assessments.builder.moveConstrained')} />
          )}
          {props.movement && assessmentQuestionPlacements(part.placements).some((placement) =>
            placement.fixed === true
          ) && <QuestionOrderNotice text={i18n.t('assessments.builder.moveFixedPositions')} />}
          {props.movement && part.placements.some((placement) =>
            'content' in placement
          ) && <QuestionOrderNotice text={i18n.t('assessments.builder.contentBlockPositions')} />}

          <div class='space-y-6'>
            {part.placements.map((placement, itemIndex) => {
              if ('content' in placement) {
                // A confirmed create may have newer unsaved input. Keep its editor at the
                // original gap until the same draft finishes; do not remount or duplicate it.
                if (
                  props.authoringState._tag === 'CreatingContent' &&
                  props.authoringState.placementId === placement.id
                ) {
                  return null;
                }
                const editing = props.authoringState._tag === 'EditingContent' &&
                    props.authoringState.placement.id === placement.id
                  ? props.authoringState
                  : null;
                if (editing && !props.contentEditor) {
                  throw new Error('Content editor ownership is missing.');
                }
                return (
                  <Fragment key={placement.id}>
                    {renderGap(part, partIndex, itemIndex)}
                    {editing && props.contentEditor
                      ? (
                        <DeferredAssessmentContentEditor
                          key={placement.id}
                          editing={editing}
                          {...props.contentEditor}
                        />
                      )
                      : (
                        <AssessmentContentBlock
                          content={placement.content}
                          label={i18n.t(
                            placement.content.kind === 'text'
                              ? 'assessments.builder.textBlock'
                              : placement.content.kind === 'image'
                              ? 'assessments.builder.imageBlock'
                              : 'assessments.builder.videoBlock',
                          )}
                          edit={props.onEditContent
                            ? {
                              id: `edit-text-${placement.id}`,
                              label: i18n.t(
                                placement.content.kind === 'text'
                                  ? 'assessments.textEditor.edit'
                                  : 'assessments.contentEditor.edit',
                              ),
                              disabled: Boolean(
                                props.actionBusy || props.movement?.status.kind === 'saving' ||
                                  props.movement?.status.kind === 'uncertain' ||
                                  props.movement?.status.kind === 'conflict',
                              ),
                              run: () => props.onEditContent?.(part.id, placement),
                            }
                            : undefined}
                        />
                      )}
                  </Fragment>
                );
              }
              const creating =
                props.authoringState._tag === 'Creating' && props.authoringState.partId === part.id
                  ? props.authoringState
                  : null;
              const creatingBefore = creating
                ? part.placements.findIndex((entry) =>
                  entry.id === creating.beforePlacementId
                )
                : -1;
              const itemNumber = `${partIndex + 1}.${
                assessmentQuestionPlacements(part.placements.slice(0, itemIndex)).length + 1 +
                (creatingBefore >= 0 && itemIndex >= creatingBefore ? 1 : 0)
              }`;
              if (
                props.authoringState._tag === 'Editing' &&
                props.authoringState.placementId === placement.id
              ) {
                if (!props.editingPresentation) {
                  throw new Error('Editing question presentation is missing.');
                }
                return (
                  <Fragment key={placement.id}>
                    {renderGap(part, partIndex, itemIndex)}
                    {moveTarget(
                      part,
                      itemIndex,
                      <EditorShell
                        loadingLabel={i18n.t('editor.loadingControls')}
                      >
                        <ActiveQuestionCard
                          moveTools={moveTools(part, itemIndex, itemNumber)}
                          onInsertBefore={() => props.onAddQuestion(part.id, placement.id)}
                          onInsertAfter={() =>
                            props.onAddQuestion(part.id, part.placements[itemIndex + 1]?.id)}
                          itemId={placement.itemId}
                          placementId={placement.id}
                          itemNumber={itemNumber}
                          headerText={props.editingPresentation.title}
                          headerType={localizedQuestionType(
                            i18n,
                            requireDraftQuestionType(props.authoringState.draft),
                          )}
                          questionType={requireDraftQuestionType(props.authoringState.draft)}
                          inspectorOpen={props.inspectorOpen}
                          actionBusy={props.actionBusy}
                          onOpenInspector={props.onOpenInspector}
                          onCreateVariant={props.onCreateVariant}
                          onExportXml={props.onExportXml}
                          onDelete={props.onDelete}
                        >
                          <DeferredItemEditorCanvas
                            persistenceStatusLocation={props.inspectorOpen ? 'inspector' : 'canvas'}
                          />
                        </ActiveQuestionCard>
                      </EditorShell>,
                    )}
                  </Fragment>
                );
              }

              const meta = props.itemMeta[placement.id];
              if (!meta) {
                throw new Error(`Question metadata is missing for placement ${placement.id}.`);
              }
              return (
                <Fragment key={placement.id}>
                  {renderGap(part, partIndex, itemIndex)}
                  {moveTarget(
                    part,
                    itemIndex,
                    <AssessmentQuestionPreview
                      moveTools={moveTools(part, itemIndex, itemNumber)}
                      onInsertBefore={() => props.onAddQuestion(part.id, placement.id)}
                      onInsertAfter={() =>
                        props.onAddQuestion(part.id, part.placements[itemIndex + 1]?.id)}
                      insertionDisabled={props.authoringState._tag === 'Creating' ||
                        props.actionBusy !== null}
                      itemNumber={itemNumber}
                      placement={placement}
                      partId={part.id}
                      meta={meta}
                      onEditItem={(itemId, placementId, partId) =>
                        props.onEditItem(itemId, placementId, partId, meta.latestRev)}
                    />,
                  )}
                </Fragment>
              );
            })}
            {renderGap(part, partIndex, part.placements.length)}

            {part.placements.length === 0 && props.authoringState._tag !== 'Creating' &&
              props.authoringState._tag !== 'CreatingContent' && (
              <div class='rounded-xl border border-dashed border-base-300 px-5 py-10 text-center'>
                <p class='text-sm text-base-content/65'>
                  {i18n.t('assessments.builder.emptyPart')}
                </p>
                <Button
                  type='button'
                  class='mt-4'
                  onClick={() =>
                    props.onAddQuestion(part.id)}
                >
                  {i18n.t('assessments.builder.addFirstQuestion')}
                </Button>
              </div>
            )}
          </div>
        </section>
      ))}
    </main>
  );
}

function requireDraftQuestionType(draft: { readonly type?: QuestionTypeId }): QuestionTypeId {
  if (!draft.type) throw new Error('Editing question type is missing.');
  return draft.type;
}

function localizedQuestionType(i18n: I18n, type: QuestionTypeId): string {
  return i18n.t('assessments.builder.questionTypeLabel', { type });
}
