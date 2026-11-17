import type { ComponentChildren, ComponentProps } from 'preact';
import AuthoringTools from '../../components/ui/AuthoringTools.tsx';
import AuthoringToolButton from '../../components/ui/AuthoringToolButton.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import type AssessmentAddDialog from './AssessmentAddDialog.tsx';
import DeferredAssessmentAddDialog from './DeferredAssessmentAddDialog.tsx';
import FloatingPicker from '../../components/ui/FloatingPicker.tsx';
import type { useAssessmentInsertion } from './useAssessmentInsertion.ts';

/** Keeps creation methods beside the canvas while the destination-aware picker is open. */
export default function AssessmentInsertTools(
  props:
    & Pick<
      ComponentProps<typeof AssessmentAddDialog>,
      | 'assessment'
      | 'existingItemIds'
      | 'onAdded'
      | 'previewContext'
      | 'lastType'
      | 'onStartAuthoring'
      | 'onStartText'
      | 'onStartContent'
    >
    & {
      readonly insertion: ReturnType<typeof useAssessmentInsertion>;
      readonly onReloadControls: () => Promise<unknown>;
      readonly children: ComponentChildren;
      readonly parts: ComponentProps<typeof AssessmentAddDialog>['parts'];
    },
) {
  const i18n = useI18n();
  const insertion = props.insertion;
  const tools = (
    <>
      <AuthoringToolButton
        label={i18n.t('assessments.builder.toolbarAdd')}
        expanded={insertion.open && insertion.method === 'create'}
        onClick={() => insertion.openSelected()}
      >
        <svg
          width='24'
          height='24'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='1.8'
        >
          <path d='M12 5v14M5 12h14' />
        </svg>
      </AuthoringToolButton>
      <AuthoringToolButton
        label={i18n.t('assessments.builder.fromLibrary')}
        expanded={insertion.open && insertion.method === 'library'}
        onClick={() => insertion.openSelected('library')}
      >
        <svg
          width='24'
          height='24'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='1.8'
        >
          <rect x='6' y='3' width='14' height='15' rx='2' />
          <path d='M3 7v12a2 2 0 0 0 2 2h11M10 8h6M10 12h6' />
        </svg>
      </AuthoringToolButton>
      <AuthoringToolButton
        label={i18n.t('assessments.builder.addTextBlock')}
        expanded={insertion.open && insertion.method === 'content'}
        onClick={() => {
          const target = insertion.selectedTarget();
          if (
            target &&
            !props.parts.find((part) => part.id === target.partId)?.options?.shuffleQuestions
          ) props.onStartContent(target, 'text');
          else insertion.openSelected('content');
        }}
      >
        <svg
          width='24'
          height='24'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='1.8'
        >
          <path d='M4 5h16M12 5v14M8 19h8' />
        </svg>
      </AuthoringToolButton>
      <AuthoringToolButton
        label={i18n.t('assessments.builder.addImageBlock')}
        expanded={insertion.open && insertion.method === 'image'}
        onClick={() => {
          const target = insertion.selectedTarget();
          if (
            target &&
            !props.parts.find((part) => part.id === target.partId)?.options?.shuffleQuestions
          ) props.onStartContent(target, 'image');
          else insertion.openSelected('image');
        }}
      >
        <svg
          width='24'
          height='24'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='1.8'
        >
          <rect x='3' y='3' width='18' height='18' rx='2' />
          <circle cx='8' cy='8' r='1.5' />
          <path d='m3 17 5-5 4 4 4-6 5 7' />
        </svg>
      </AuthoringToolButton>
      <AuthoringToolButton
        label={i18n.t('assessments.builder.addVideoBlock')}
        expanded={insertion.open && insertion.method === 'video'}
        onClick={() => insertion.openSelected('video')}
      >
        <svg
          width='24'
          height='24'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='1.8'
        >
          <rect x='3' y='4' width='18' height='16' rx='2' />
          <path d='m10 8 6 4-6 4Z' />
        </svg>
      </AuthoringToolButton>
      <AuthoringToolButton
        label={i18n.t('assessments.builder.toolbarText')}
        expanded={insertion.open && insertion.method === 'text'}
        onClick={() => insertion.openSelected('text')}
      >
        <svg
          width='24'
          height='24'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='1.8'
        >
          <path d='m4 17-1 4 4-1L20 7l-3-3L4 17ZM14 7l3 3' />
        </svg>
      </AuthoringToolButton>
    </>
  );
  return (
    <AuthoringTools label={i18n.t('assessments.builder.insertionTools')} tools={tools}>
      {props.children}
      {insertion.open && (
        <FloatingPicker
          label={i18n.t(
            insertion.method === 'content'
              ? 'assessments.builder.addTextBlock'
              : insertion.method === 'image'
              ? 'assessments.builder.addImageBlock'
              : insertion.method === 'video'
              ? 'assessments.builder.addVideoBlock'
              : 'assessments.builder.insertQuestion',
          )}
          onClose={insertion.close}
          trigger={insertion.trigger}
          wide={insertion.method === 'library'}
        >
          <DeferredAssessmentAddDialog
            onReloadControls={props.onReloadControls}
            open
            method={insertion.method}
            onMethodChange={insertion.selectMethod}
            trigger={insertion.trigger}
            beforePlacementId={insertion.target?.beforePlacementId}
            part={insertion.part}
            parts={props.parts}
            onPartChange={insertion.selectPart}
            onClose={insertion.close}
            assessment={props.assessment}
            existingItemIds={props.existingItemIds}
            onAdded={props.onAdded}
            previewContext={props.previewContext}
            lastType={props.lastType}
            onStartAuthoring={props.onStartAuthoring}
            onStartText={props.onStartText}
            onStartContent={props.onStartContent}
          />
        </FloatingPicker>
      )}
    </AuthoringTools>
  );
}
