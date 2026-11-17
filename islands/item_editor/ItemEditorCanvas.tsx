import { useDomId } from '../../lib/rendering/island_context.tsx';
import DeferredAnswerFeedbackEditor from '../../components/item_editor/DeferredAnswerFeedbackEditor.tsx';
import { h } from 'preact';
import QuestionTextAssistance from './QuestionTextAssistance.tsx';
import { useRef } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import QuestionWritingLayout from '../../components/ui/QuestionWritingLayout.tsx';
import Tabs from '../../components/ui/Tabs.tsx';
import QtiItemPreview from '../QtiItemPreview.tsx';
import RichTextEditor from '../RichTextEditor.tsx';
import { driverViewsFor } from '../drivers/view_registry.ts';
import { useItemEditorState } from './context.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import QuestionPresentation from './QuestionPresentation.tsx';
import { useContentFieldReview } from './useContentFieldReview.ts';
import QuestionPersistenceStatus from '../../components/item_editor/QuestionPersistenceStatus.tsx';

import '@prosekit/basic/style.css';
import '@prosekit/basic/typography.css';

type ItemEditorTabValue = 'content' | 'preview';
type ItemEditorTab = { readonly value: ItemEditorTabValue; readonly label: string };

/** The composition chooses one visible location for the canonical persistence announcement. */
export type ItemEditorCanvasProps = {
  readonly persistenceStatusLocation: 'canvas' | 'inspector';
};

/** Primary first-pass question authoring surface. */
export default function ItemEditorCanvas(props: ItemEditorCanvasProps) {
  const state = useItemEditorState();
  const i18n = useI18n();
  const questionTextLabelId = useDomId();
  const canvasRef = useRef<HTMLDivElement>(null);
  useContentFieldReview(
    canvasRef,
    state.navigation.contentReview,
    state.navigation.finishContentReview,
  );
  const { showPreviewOnly, tab, setTab } = state.navigation;
  const {
    qtype,
    draft,
    setDraft,
    driverViews,
    retryDriverViews,
    driverEditor,
    bodyEditorApi,
    bodyHtml,
    setBodyHtml,
    focusQuestionText,
    catalogs,
  } = state.content;
  const {
    fieldHasIssue,
    fieldIssueText,
    canSave,
    saveStatus,
    save,
    savedId,
    errors,
    error,
    fieldIssues,
    previewXml,
  } = state.persistence;
  const { title } = state.inspector;
  const saving = saveStatus === 'saving';
  const tabs: readonly [ItemEditorTab, ItemEditorTab] = [
    { value: 'content', label: i18n.t('editor.content') },
    { value: 'preview', label: i18n.t('editor.preview') },
  ];

  if (showPreviewOnly) return null;

  function renderPanel(selectedTab: ItemEditorTabValue) {
    if (selectedTab === 'preview') {
      if (!previewXml) return null;
      if (previewXml.ok) {
        return (
          <QtiItemPreview
            xml={previewXml.xml}
            title={previewXml.title}
            mode='author'
            showDiagnostics
            payload={state.content.payload}
            playerCatalog={state.content.playerCatalog}
          />
        );
      }
      return (
        <div class='ds-card ds-card-border border-base-200/70 bg-base-100'>
          <div class='ds-card-body space-y-3'>
            <div>
              <div class='text-xs uppercase text-base-content/60'>{i18n.t('editor.preview')}</div>
              <h3 class='text-lg font-medium text-base-content'>
                {previewXml.title || title || i18n.t('preview.untitled')}
              </h3>
            </div>
            <div class='rounded-md border border-warning/30 bg-warning/10 p-3 text-sm'>
              <div class='mb-1 font-medium'>
                {i18n.t('preview.unavailable')}
              </div>
              <ul class='list-disc space-y-1 pl-5'>
                {previewXml.issues.map((issue, index) => (
                  <li key={`${issue.message}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div class='space-y-3'>
        <div class='space-y-3'>
          {state.content.textAssistance && (
            <QuestionTextAssistance {...state.content.textAssistance} />
          )}
          <QuestionWritingLayout presentation={<QuestionPresentation />}>
            <div data-editor-field='body'>
              <div
                id={questionTextLabelId}
                class='sr-only'
              >
                {i18n.t('editor.questionText')}
              </div>
              <RichTextEditor
                valueHtml={bodyHtml}
                onChangeHtml={setBodyHtml}
                placeholder={i18n.t('editor.questionStemPlaceholder')}
                minHeight={48}
                class={fieldHasIssue('body') ? 'border-error/60 ring-1 ring-error/40' : ''}
                registerApi={(api) => {
                  bodyEditorApi.current = api;
                }}
                contentScope='body'
                appearance='question'
                autoFocus={focusQuestionText}
                catalogIds={catalogs.map((catalog) => catalog.id).filter(Boolean)}
                ariaLabelledBy={questionTextLabelId}
                ariaInvalid={fieldHasIssue('body') || undefined}
                ariaDescribedBy={fieldHasIssue('body') ? `${questionTextLabelId}-issue` : undefined}
              />
              {fieldHasIssue('body') && (
                <p id={`${questionTextLabelId}-issue`} class='text-xs text-error'>
                  {fieldIssueText('body')}
                </p>
              )}
            </div>
          </QuestionWritingLayout>

          {driverViews._tag === 'Loading' && (
            <div
              class='rounded-lg bg-base-200/60 px-4 py-5 text-sm text-base-content/70'
              role='status'
            >
              {i18n.t('editor.loadingControls')}
            </div>
          )}
          {driverViews._tag === 'Failed' && (
            <div class='ds-alert ds-alert-error items-start' role='alert'>
              <div class='space-y-2'>
                <p>{i18n.t('editor.controlsFailed')}</p>
                <Button type='button' size='sm' onClick={retryDriverViews}>
                  {i18n.t('editor.retryControls')}
                </Button>
              </div>
            </div>
          )}
          {driverViews._tag === 'Ready' && (
            renderDriverView()
          )}
          <DeferredAnswerFeedbackEditor />
        </div>

        <div class='mt-4 flex flex-wrap gap-2'>
          <Button variant='primary' disabled={!canSave || saving} onClick={() => save()}>
            {saving ? i18n.t('editor.saving') : i18n.t('editor.save')}
          </Button>
          {props.persistenceStatusLocation === 'canvas' && <QuestionPersistenceStatus />}
          {savedId && <Button href={`/items/${savedId}`}>{i18n.t('editor.viewSnapshot')}</Button>}
        </div>

        {fieldIssues.general.length > 0 && (
          <ul class='ds-alert ds-alert-error' role='alert'>
            {fieldIssues.general.map((message, index) => (
              <li key={`${index}-${message}`}>{message}</li>
            ))}
          </ul>
        )}
        {errors.length > 0 && (
          <ul class='ds-alert ds-alert-error' role='alert'>
            {errors.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
          </ul>
        )}
        {error && <div class='ds-alert ds-alert-error' role='alert'>{error}</div>}
      </div>
    );
  }

  function renderDriverView() {
    const views = driverViewsFor(qtype);
    if (!views) {
      throw new Error(`Question controls are not registered for ${qtype}.`);
    }
    return h(views.ui, {
      key: qtype,
      draft,
      update: setDraft,
      editor: driverEditor,
    });
  }

  return (
    <div class='item-editor-container' ref={canvasRef}>
      <Tabs
        ariaLabel={i18n.t('editor.tabs')}
        value={tab}
        onChange={setTab}
        items={tabs}
        keepMounted={state.content.textAssistance || state.content.feedbackUploading
          ? ['content']
          : []}
        renderPanel={renderPanel}
      />
    </div>
  );
}
