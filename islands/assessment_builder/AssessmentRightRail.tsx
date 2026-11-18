import { uiEvent } from '../../lib/client/ui_event.ts';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { ComponentChildren, RefObject } from 'preact';
import { standaloneInlineChoice } from '../../lib/types/inline_choice.ts';
import type { FieldKey } from '../../lib/validation_fields.ts';
import type { ContentReviewField } from '../item_editor/context.ts';
import Button from '../../components/ui/Button.tsx';
import TagInput from '../../components/ui/TagInput.tsx';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import { TYPE_DRIVERS } from '../../lib/types/registry.ts';
import { buildRightRailControls } from '../drivers/right_rail/build_controls.tsx';
import type { RailDraft } from '../drivers/right_rail/rail_draft.ts';
import { driverViewsFor } from '../drivers/view_registry.ts';
import { useItemEditorState } from '../item_editor/context.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import DeferredItemEditorInspector from '../item_editor/DeferredItemEditorInspector.tsx';

type Props = {
  open: boolean;
  questionLabel: string;
  rightRailType: QuestionTypeId | null;
  settingsDraft: RailDraft;
  onSettingsDraftChange: (draft: RailDraft) => void;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  onClose: () => void;
  children?: ComponentChildren;
};

/** Render the assessment inspector from the canonical item-editor persistence state. */
export default function AssessmentRightRail({
  open,
  questionLabel,
  rightRailType,
  settingsDraft,
  onSettingsDraftChange,
  tags,
  onTagsChange,
  onClose,
  children,
}: Props) {
  const editorState = useItemEditorState();
  const { saveStatus, save, canSave, error, errors, fieldIssueText } = editorState.persistence;
  const i18n = useI18n();
  const inspectorRef = useRef<HTMLElement | null>(null);
  const activeDriver = rightRailType ? TYPE_DRIVERS[rightRailType] : null;
  const activeViews = rightRailType ? driverViewsFor(rightRailType) : undefined;
  const rightRailControls = open && rightRailType && activeDriver
    ? buildRightRailControls(
      rightRailType,
      activeDriver.capabilities,
      settingsDraft,
      onSettingsDraftChange,
      {
        scoringTemplates: activeDriver.scoringTemplates,
        itemLanguageMessages: {
          label: i18n.t('itemLanguage.label'),
          help: i18n.t('itemLanguage.help'),
          required: i18n.t('itemLanguage.required'),
          invalid: i18n.t('itemLanguage.invalid'),
        },
        t: i18n.t,
        fieldIssueText,
      },
    )
    : null;

  useLayoutEffect(() => {
    if (!open) return;
    inspectorRef.current?.querySelector<HTMLButtonElement>('[data-close-inspector]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    }
    globalThis.addEventListener('keydown', closeOnEscape);
    return () => globalThis.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  return (
    <aside
      ref={inspectorRef}
      id='question-settings-inspector'
      hidden={!open}
      aria-labelledby='question-settings-heading'
      aria-hidden={!open}
      inert={open ? undefined : true}
      class={`fixed inset-y-0 right-0 z-50 w-full flex-col bg-base-100 shadow-2xl sm:w-96 ${
        open ? 'flex' : 'hidden'
      }`}
    >
      <div class='sticky top-0 z-10 border-b border-base-200 bg-base-100 px-4 py-4 sm:px-5'>
        <div class='flex items-start justify-between gap-4'>
          <div class='min-w-0'>
            <h2 id='question-settings-heading' class='text-base font-semibold text-base-content'>
              {i18n.t('assessments.builder.questionSettings')}
            </h2>
            <p class='mt-1 truncate text-sm text-base-content/65' title={questionLabel}>
              {questionLabel}
            </p>
          </div>
          <Button
            data-close-inspector
            type='button'
            variant='ghost'
            size='sm'
            square
            aria-label={i18n.t('assessments.builder.closeQuestionSettings')}
            onClick={onClose}
          >
            <span aria-hidden='true'>✕</span>
          </Button>
        </div>
        <div class='mt-3 min-h-5' aria-live='polite' aria-atomic='true'>
          {error && <p class='text-sm text-error'>{error}</p>}
          {saveStatus === 'saving' && <p class='text-sm'>{i18n.t('editor.saving')}</p>}
          {!error && saveStatus === 'dirty' && (
            <span class='ds-badge ds-badge-warning ds-badge-sm'>
              {i18n.t('editor.unsavedChanges')}
            </span>
          )}
          {!error && saveStatus === 'saved' && (
            <span class='ds-badge border-secondary/30 bg-base-200 text-secondary ds-badge-sm'>
              {i18n.t('editor.itemSaved')}
            </span>
          )}
        </div>
        <Button
          type='button'
          class='mt-3 w-full'
          variant='primary'
          disabled={!canSave || saveStatus === 'saving'}
          onClick={uiEvent(() => save())}
        >
          {saveStatus === 'saving'
            ? i18n.t('editor.saving')
            : i18n.t('assessments.builder.saveQuestion')}
        </Button>
        {errors.length > 0 && (
          <ul class='mt-2 list-inside list-disc text-sm text-error'>
            {errors.map((message) => <li key={message}>{message}</li>)}
          </ul>
        )}
        <QuestionFieldReview inspector={inspectorRef} onReturnToContent={onClose} />
      </div>

      {open && (
        <div class='flex-1 space-y-5 overflow-y-auto p-4 sm:p-5'>
          {rightRailControls && rightRailType && activeViews?.rightRail({
            controls: {
              ...rightRailControls,
              sections: rightRailControls.sections.filter((section) =>
                section.group === 'answer' || section.group === 'scoring'
              ),
            },
          })}
          <DeferredItemEditorInspector
            sections={rightRailControls?.sections}
            detailsContent={
              <>
                {children}
                <label class='block space-y-2'>
                  <span>{i18n.t('assessments.builder.tags')}</span>
                  <TagInput
                    value={tags}
                    placeholder={i18n.t('assessments.builder.tagExample')}
                    removeLabel={(tag) => i18n.t('assessments.builder.removeTag', { tag })}
                    onChange={onTagsChange}
                  />
                </label>
              </>
            }
          />
        </div>
      )}
    </aside>
  );
}

const LABELS = {
  title: 'inspector.reviewTitle',
  body: 'inspector.reviewQuestionText',
  prompt: 'inspector.reviewPrompt',
  choices: 'inspector.reviewAnswers',
  correct: 'inspector.reviewCorrectAnswer',
  maximumScore: 'inspector.reviewPoints',
  matchSources: 'inspector.reviewMatchingSources',
  matchTargets: 'inspector.reviewMatchingTargets',
  matchPairs: 'inspector.reviewMatchingPairs',
  order: 'inspector.reviewOrder',
  textEntry: 'inspector.reviewTextEntries',
  minChoices: 'inspector.reviewMinimumSelections',
  maxChoices: 'inspector.reviewMaximumSelections',
} as const satisfies Partial<Record<FieldKey, string>>;

const SPECIALIZED_REVIEW_FIELDS: Partial<Record<QuestionTypeId, readonly ContentReviewField[]>> = {
  match: ['matchSources', 'matchTargets', 'matchPairs'],
  associate: ['choices', 'matchPairs'],
  order: ['order'],
  text_entry: ['textEntry'],
  inline_choice: ['choices', 'correct'],
  gap_match: ['choices', 'matchPairs', 'correct'],
  hottext: ['choices', 'correct'],
  slider: ['correct'],
  hotspot: ['choices', 'correct'],
  select_point: ['correct'],
  position_object: ['correct'],
  graphic_associate: ['choices', 'matchPairs', 'correct'],
  graphic_order: ['choices', 'order', 'correct'],
  graphic_gap_match: ['choices', 'matchSources', 'matchTargets', 'matchPairs', 'correct'],
};

// The save vocabulary describes correctness broadly; each graphic editor owns its concrete control.
const REVIEW_DESTINATIONS: Partial<
  Record<QuestionTypeId, Partial<Record<ContentReviewField, ContentReviewField>>>
> = {
  graphic_associate: { correct: 'matchPairs' },
  graphic_order: { correct: 'order' },
  graphic_gap_match: { correct: 'matchPairs', matchSources: 'choices' },
};

/** Offer only rejected fields with a concrete destination in the current question editor. */
function QuestionFieldReview({ inspector, onReturnToContent }: {
  readonly inspector: RefObject<HTMLElement>;
  readonly onReturnToContent: () => void;
}) {
  const state = useItemEditorState();
  const i18n = useI18n();
  const frame = useRef<number | null>(null);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);
  const { qtype, draft, driver } = state.content;
  const dropdown = qtype === 'inline_choice'
    ? standaloneInlineChoice({ bodyHtml: draft.bodyHtml, inlineChoices: draft.inlineChoices ?? [] })
    : null;
  const ordinaryAnswers = qtype === 'single_select' || qtype === 'multi_select' ||
    Boolean(
      dropdown?.slot.options.every((option) => !option.html?.trim() && option.score === undefined),
    );
  const contentFields: readonly ContentReviewField[] = ordinaryAnswers
    ? [
      'body',
      'prompt',
      'choices',
      'correct',
      ...(qtype === 'single_select' || qtype === 'multi_select' ? ['maximumScore' as const] : []),
    ]
    : ['body', 'prompt', ...(SPECIALIZED_REVIEW_FIELDS[qtype] ?? [])];
  const settingsFields = driver?.capabilities?.minMaxChoices
    ? ['title', 'minChoices', 'maxChoices'] as const
    : ['title'] as const;

  function reviewSetting(field: typeof settingsFields[number]) {
    const group = field === 'title' ? 'details' : 'answer';
    const toggle = inspector.current?.querySelector<HTMLButtonElement>(
      `[data-settings-group="${group}"] h3 button`,
    );
    if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const input = inspector.current?.querySelector<HTMLInputElement>(
        `[data-settings-field="${field}"]`,
      );
      input?.focus({ preventScroll: true });
      input?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
  }

  return (
    <>
      {settingsFields.filter(state.persistence.fieldHasIssue).map((field) => (
        <Button
          key={field}
          type='button'
          variant='text'
          size='sm'
          onClick={() => reviewSetting(field)}
        >
          {i18n.t(LABELS[field])}
        </Button>
      ))}
      {contentFields.filter(state.persistence.fieldHasIssue).map((field) => (
        <Button
          key={field}
          type='button'
          variant='text'
          size='sm'
          onClick={() => {
            onReturnToContent();
            state.navigation.reviewContentField(REVIEW_DESTINATIONS[qtype]?.[field] ?? field);
          }}
        >
          {i18n.t(LABELS[field])}
        </Button>
      ))}
    </>
  );
}
