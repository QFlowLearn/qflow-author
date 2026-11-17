import AuthoringToolButton from '../../components/ui/AuthoringToolButton.tsx';
import QuestionActionTools from '../../components/ui/QuestionActionTools.tsx';
import Button from '../../components/ui/Button.tsx';
import type { ItemActionBusy } from './types.ts';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

export function SettingsButton({
  open,
  onOpen,
}: {
  open: boolean;
  onOpen: (trigger: HTMLElement) => void;
}) {
  const i18n = useI18n();
  return (
    <Button
      type='button'
      size='sm'
      aria-expanded={open}
      aria-controls='question-settings-inspector'
      onClick={(event) => onOpen(event.currentTarget)}
    >
      {i18n.t('assessments.builder.questionSettings')}
    </Button>
  );
}

export function ItemActions({
  actionBusy,
  questionType,
  onInsertBefore,
  onInsertAfter,
  onCreateVariant,
  onExportXml,
  onDelete,
}: {
  actionBusy: ItemActionBusy;
  questionType: QuestionTypeId;
  onInsertBefore?: () => void;
  onInsertAfter?: () => void;
  onCreateVariant: (targetType?: QuestionTypeId) => void;
  onExportXml: () => void;
  onDelete: () => void;
}) {
  const i18n = useI18n();
  return (
    <QuestionActionTools>
      <AuthoringToolButton
        label={i18n.t('assessments.builder.duplicateQuestion')}
        disabled={actionBusy !== null}
        onClick={() => onCreateVariant()}
      >
        <svg
          width='20'
          height='20'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='1.6'
        >
          <rect x='8' y='8' width='12' height='12' rx='2' />
          <path d='M16 8V4H4v12h4' />
        </svg>
      </AuthoringToolButton>
      <AuthoringToolButton
        label={i18n.t('assessments.builder.deleteQuestion')}
        disabled={actionBusy !== null}
        danger
        onClick={onDelete}
      >
        <svg
          width='20'
          height='20'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='1.6'
        >
          <path d='M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7' />
        </svg>
      </AuthoringToolButton>
      <div class='ds-dropdown ds-dropdown-end'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          square
          aria-label={i18n.t('assessments.builder.questionActions')}
          tabIndex={0}
        >
          <span aria-hidden='true'>•••</span>
        </Button>
        <ul
          tabIndex={0}
          class='ds-dropdown-content ds-menu z-20 w-52 rounded-box bg-base-100 shadow-lg'
        >
          {onInsertBefore && (
            <li>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={actionBusy !== null}
                onClick={onInsertBefore}
              >
                {i18n.t('assessments.builder.insertBefore')}
              </Button>
            </li>
          )}
          {onInsertAfter && (
            <li>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={actionBusy !== null}
                onClick={onInsertAfter}
              >
                {i18n.t('assessments.builder.insertAfter')}
              </Button>
            </li>
          )}
          {questionType === 'single_select' && (
            <li>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                class='justify-start'
                disabled={actionBusy !== null}
                onClick={() => onCreateVariant('multi_select')}
              >
                {i18n.t('assessments.builder.createMultiVariant')}
              </Button>
            </li>
          )}
          <li>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              class='justify-start'
              disabled={actionBusy !== null}
              onClick={onExportXml}
            >
              {i18n.t('assessments.builder.exportQuestionXml')}
            </Button>
          </li>
        </ul>
      </div>
    </QuestionActionTools>
  );
}
