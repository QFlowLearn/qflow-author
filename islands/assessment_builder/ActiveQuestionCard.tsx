import { assessmentQuestionAnchor } from '../../lib/assessment_content.ts';
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ItemActionBusy } from './types.ts';
import { EDITOR_CARD } from './ui_constants.ts';
import { ItemActions, SettingsButton } from './AssessmentCanvasControls.tsx';
import type { QuestionTypeId } from '../../lib/types/registry.ts';

export function ActiveQuestionCard({
  itemNumber,
  headerText,
  headerType,
  questionType,
  inspectorOpen,
  actionBusy,
  children,
  onOpenInspector,
  onInsertBefore,
  onInsertAfter,
  onCreateVariant,
  onExportXml,
  onDelete,
  itemId,
  placementId,
  moveTools,
}: {
  itemNumber: string;
  headerText: string;
  headerType: string;
  questionType: QuestionTypeId;
  inspectorOpen: boolean;
  actionBusy: ItemActionBusy;
  children: ComponentChildren;
  onOpenInspector: (trigger: HTMLElement) => void;
  onInsertBefore?: () => void;
  onInsertAfter?: () => void;
  onCreateVariant: (targetType?: QuestionTypeId) => void;
  onExportXml: () => void;
  onDelete: () => void;
  itemId?: string;
  placementId?: string;
  moveTools?: ComponentChildren;
}) {
  const cardRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!itemId) return;
    const frame = requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ block: 'start', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [itemId]);

  return (
    <article
      ref={cardRef}
      id={placementId ? assessmentQuestionAnchor(placementId) : undefined}
      tabIndex={-1}
      data-authoring-card={itemId}
      class={`${EDITOR_CARD} ring-2 ring-primary/15`}
      style={{ scrollMarginTop: '5rem' }}
    >
      <div class='flex flex-wrap items-start justify-between gap-3 border-b border-base-200 pb-4'>
        <div class='flex min-w-0 items-center gap-3'>
          {moveTools}
          <span class='grid size-8 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-content'>
            {itemNumber}
          </span>
          <div class='min-w-0'>
            <h3 class='truncate text-xs font-normal text-base-content/70' title={headerText}>
              {headerText}
            </h3>
            {questionType !== 'single_select' && questionType !== 'inline_choice' && (
              <div class='mt-1 text-xs text-base-content/70'>{headerType}</div>
            )}
          </div>
        </div>
        <div class='flex min-w-0 max-w-full flex-wrap items-center gap-1'>
          <SettingsButton open={inspectorOpen} onOpen={onOpenInspector} />
          {itemId && (
            <ItemActions
              actionBusy={actionBusy}
              questionType={questionType}
              onInsertBefore={onInsertBefore}
              onInsertAfter={onInsertAfter}
              onCreateVariant={onCreateVariant}
              onExportXml={onExportXml}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>
      {children}
    </article>
  );
}
