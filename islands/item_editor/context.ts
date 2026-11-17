import type { useQuestionPoints } from '../../components/item_editor/useQuestionPoints.ts';
import type { ItemEditorProps } from './types.ts';
import { createContext, type RefObject } from 'preact';
import { useContext } from 'preact/hooks';
import type { CatalogDraft, Draft, StylesheetDraft } from '../../lib/types/draft.ts';
import { type QuestionTypeId, TYPE_DRIVERS } from '../../lib/types/registry.ts';
import type { CurriculumStandardAlignment } from '../../lib/standards.ts';
import type { FieldKey } from '../../lib/validation_fields.ts';
import type { RichTextEditorApi } from '../RichTextEditor.tsx';
import type { DriverEditorShell } from '../drivers/types.ts';
import { collectA11yIssues } from '../../lib/a11y_checks.ts';
import { buildQtiPreviewXml } from '../../lib/qti_preview.ts';
import type { AssessmentBlueprint } from '../../lib/assessment_blueprint.ts';
import type { QuestionReviewSuggestion } from '../../lib/question_review_types.ts';
import type { DriverViewsState } from './useDriverViews.ts';
import type { QflowPlayerMessageCatalog } from '../../lib/i18n/player_messages/types.ts';
import type { I18nPayload } from '../../lib/i18n/payload.ts';
import type { useQuestionPresentation } from './useQuestionPresentation.ts';

/** User-visible persistence state for the explicit item save boundary. */
export type ItemEditorSaveStatus = 'clean' | 'dirty' | 'saving' | 'saved';

/** Canvas fields with an explicit review destination in the question editor. */
export type ContentReviewField =
  | 'body'
  | 'prompt'
  | 'maximumScore'
  | 'choices'
  | 'correct'
  | 'matchSources'
  | 'matchTargets'
  | 'matchPairs'
  | 'order'
  | 'textEntry';

/** One requested focus transfer, retained until its deferred control is ready. */
export type ContentReviewRequest = {
  readonly field: ContentReviewField;
  readonly sequence: number;
};

/** State shared by the item editor's canvas and contextual inspector. */
export type ItemEditorState = {
  navigation: {
    showPreviewOnly: boolean;
    tab: 'content' | 'preview';
    setTab: (tab: 'content' | 'preview') => void;
    contentReview: ContentReviewRequest | null;
    reviewContentField: (field: ContentReviewField) => void;
    finishContentReview: (sequence: number) => void;
  };
  content: {
    points: ReturnType<typeof useQuestionPoints>;
    feedbackUploading: boolean;
    setFeedbackUploadBusy: (busy: boolean) => void;
    setAssistancePending: (pending: boolean) => void;
    textAssistance?: ItemEditorProps['textAssistance'];
    playerCatalog: QflowPlayerMessageCatalog;
    payload: I18nPayload;
    qtype: QuestionTypeId;
    presentation: ReturnType<typeof useQuestionPresentation>;
    draft: Draft;
    setDraft: (value: Draft | ((prev: Draft) => Draft)) => void;
    driver: (typeof TYPE_DRIVERS)[QuestionTypeId] | undefined;
    driverViews: DriverViewsState;
    retryDriverViews: () => void;
    driverEditor: DriverEditorShell;
    bodyEditorApi: RefObject<RichTextEditorApi | null>;
    bodyHtml: string;
    setBodyHtml: (value: string | ((prev: string) => string)) => void;
    focusQuestionText?: boolean;
    catalogs: CatalogDraft[];
  };
  persistence: {
    canSave: boolean;
    saveStatus: ItemEditorSaveStatus;
    /** True only after persistence succeeds with no newer edits left in this editor. */
    save: () => Promise<boolean>;
    savedId: string | null;
    errors: string[];
    error: string | null;
    fieldIssues: Record<FieldKey, string[]>;
    fieldHasIssue: (field: FieldKey) => boolean;
    fieldIssueText: (field: FieldKey) => string | undefined;
    previewXml: ReturnType<typeof buildQtiPreviewXml> | null;
  };
  inspector: {
    title: string;
    setTitle: (value: string) => void;
    titleLocked: boolean;
    setTitleLocked: (value: boolean) => void;
    standards: CurriculumStandardAlignment[];
    addStandard: () => void;
    updateStandard: (index: number, patch: Partial<CurriculumStandardAlignment>) => void;
    removeStandard: (index: number) => void;
    catalogs: CatalogDraft[];
    setCatalogs: (value: CatalogDraft[]) => void;
    stylesheets: StylesheetDraft[];
    setStylesheets: (value: StylesheetDraft[]) => void;
    a11yIssues: ReturnType<typeof collectA11yIssues>;
    blueprint?: AssessmentBlueprint;
    blueprintTargetId?: string;
    setBlueprintTargetId: (targetId: string | undefined) => void;
    reviewSuggestions: readonly QuestionReviewSuggestion[];
  };
};

/** Context owned by ItemEditorProvider. */
export const ItemEditorContext = createContext<ItemEditorState | null>(null);

/** Reads the canonical item editor state. */
export function useItemEditorState(): ItemEditorState {
  const value = useContext(ItemEditorContext);
  if (!value) throw new Error('Item editor components must render inside ItemEditorProvider.');
  return value;
}
