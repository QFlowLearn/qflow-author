import type { AssessmentInsertionMethod } from './useAssessmentInsertion.ts';
import type { AssessmentStandaloneContent } from '../../lib/assessment_standalone_content.ts';
import { useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Select from '../../components/ui/Select.tsx';
import Tabs from '../../components/ui/Tabs.tsx';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import ImportPicker from './DeferredImportPicker.tsx';
import QuestionTypePicker from './QuestionTypePicker.tsx';
import type { AssessmentView, Part } from './types.ts';
import type { BankSelectionResult } from '../../lib/assessment_bank_selection.ts';
import type { BankPreviewContext } from './BankQuestionPreview.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';

/** Nonmodal creation and bank picker with an explicit insertion destination. */
export default function AssessmentAddDialog(props: {
  readonly open: boolean;
  readonly method: AssessmentInsertionMethod;
  readonly onMethodChange: (method: 'create' | 'library') => void;
  readonly trigger: HTMLElement | null;
  readonly beforePlacementId?: string;
  readonly onClose: () => void;
  readonly assessment: Pick<AssessmentView, 'id'>;
  readonly lastType: QuestionTypeId | null;
  readonly part: Part | undefined;
  readonly parts: readonly Part[];
  readonly onPartChange: (partId: string) => void;
  readonly existingItemIds: ReadonlySet<string>;
  readonly onAdded: (result: BankSelectionResult) => void;
  readonly previewContext: BankPreviewContext;
  readonly onStartAuthoring: (type: QuestionTypeId) => void;
  readonly onStartText: () => void;
  readonly onStartContent: (
    target: { readonly partId: string; readonly beforePlacementId?: string },
    kind: AssessmentStandaloneContent['kind'],
  ) => void;
}) {
  const addTab = props.method === 'library' ? 'library' : 'create';
  const [typeSearch, setTypeSearch] = useState('');
  const i18n = useI18n();
  const tabs = [
    {
      value: 'create' as const,
      label: i18n.t('assessments.builder.createNew'),
      focusPanelSelector: '[data-focus-type-search]',
    },
    {
      value: 'library' as const,
      label: i18n.t('assessments.builder.fromLibrary'),
      focusPanelSelector: '[data-focus-library-search]',
    },
  ] as const;
  if (!props.open) return null;
  const part = props.part;
  const contentMethod = props.method === 'content' || props.method === 'image' ||
    props.method === 'video';
  return (
    <div class='space-y-4'>
      <div class='flex items-center justify-between gap-3'>
        <h2 class='text-base font-medium'>{i18n.t('assessments.builder.addToAssessment')}</h2>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          aria-label={i18n.t('assessments.builder.closeAddDialog')}
          onClick={props.onClose}
        >
          ✕
        </Button>
      </div>
      {props.parts.length > 1 && (
        <div class='space-y-1 text-sm'>
          <label for='assessment-insert-part'>{i18n.t('assessments.builder.insertPart')}</label>
          <Select
            id='assessment-insert-part'
            data-picker-focus
            value={part?.id ?? ''}
            onChange={(event) => props.onPartChange(event.currentTarget.value)}
          >
            <option value='' disabled>{i18n.t('assessments.builder.chooseInsertPart')}</option>
            {props.parts.map((entry, index) => (
              <option key={entry.id} value={entry.id}>
                {i18n.t('assessments.builder.partHeading', {
                  number: index + 1,
                  title: entry.title,
                })}
              </option>
            ))}
          </Select>
        </div>
      )}
      {part && (
        <p class='text-sm text-base-content/65'>
          {part.title} · {i18n.t('assessments.builder.insertAt', {
            number: `${props.parts.findIndex((entry) => entry.id === part.id) + 1}.${
              (props.beforePlacementId
                ? part.placements.findIndex((entry) => entry.id === props.beforePlacementId)
                : part.placements.length) + 1
            }`,
          })}
        </p>
      )}
      {part && contentMethod && part.options?.shuffleQuestions && (
        <p role='status'>{i18n.t('assessments.builder.contentRequiresOrder')}</p>
      )}
      {part && (contentMethod
        ? (
          <div class='space-y-3'>
            <Button
              variant='primary'
              disabled={part.options?.shuffleQuestions === true}
              onClick={() =>
                props.onStartContent(
                  { partId: part.id, beforePlacementId: props.beforePlacementId },
                  props.method === 'image' ? 'image' : props.method === 'video' ? 'video' : 'text',
                )}
            >
              {i18n.t(
                props.method === 'image'
                  ? 'assessments.builder.addImageBlock'
                  : props.method === 'video'
                  ? 'assessments.contentEditor.uploadVideo'
                  : 'assessments.builder.addTextBlock',
              )}
            </Button>
            {props.method === 'video' && (
              <>
                <Button
                  disabled={part.options?.shuffleQuestions === true}
                  onClick={() =>
                    props.onStartContent({
                      partId: part.id,
                      beforePlacementId: props.beforePlacementId,
                    }, 'video-link')}
                >
                  {i18n.t('assessments.contentEditor.addOnlineVideo')}
                </Button>
                <p>{i18n.t('assessments.contentEditor.networkNotice')}</p>
              </>
            )}
          </div>
        )
        : props.method === 'text'
        ? (
          <Button variant='primary' onClick={props.onStartText}>
            {i18n.t('editor.assistance.title')}
          </Button>
        )
        : (
          <Tabs
            ariaLabel={i18n.t('assessments.builder.addQuestionMethod')}
            value={addTab}
            onChange={props.onMethodChange}
            items={tabs}
            renderPanel={(tab) =>
              tab === 'create'
                ? (
                  <QuestionTypePicker
                    compact
                    search={typeSearch}
                    onSearchChange={setTypeSearch}
                    onStartAuthoring={props.onStartAuthoring}
                    onStartText={props.onStartText}
                    lastType={props.lastType}
                  />
                )
                : (
                  <ImportPicker
                    assessmentId={props.assessment.id}
                    partId={part.id}
                    beforePlacementId={props.beforePlacementId}
                    partTitle={part.title}
                    existingItemIds={props.existingItemIds}
                    onAdded={props.onAdded}
                    previewContext={props.previewContext}
                  />
                )}
          />
        ))}
    </div>
  );
}
