import { useDomId } from '../../lib/rendering/island_context.tsx';
import { parseAnswerFeedback } from '../../lib/answer_feedback.ts';
import { useQuestionPoints } from '../../components/item_editor/useQuestionPoints.ts';
import QuestionPoints from '../../components/item_editor/QuestionPoints.tsx';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { RichTextEditorApi } from '../RichTextEditor.tsx';
import { type QuestionTypeId, TYPE_DRIVERS } from '../../lib/types/registry.ts';
import type { CatalogDraft, Draft, StylesheetDraft } from '../../lib/types/draft.ts';
import { canonicalJsonStringify, projectJsonPersistenceObject } from '../../lib/canonical_json.ts';
import { normalizeDraftForDriver, resolveDriver } from '../../lib/types/draft_utils.ts';
import OptionalInstructionsField from '../../components/ui/OptionalInstructionsField.tsx';
import type { FieldKey } from '../../lib/validation_fields.ts';
import { collectA11yIssues } from '../../lib/a11y_checks.ts';
import { autoTitleFromPrompt } from '../../lib/auto_title.ts';
import {
  type CurriculumStandardAlignment,
  normalizeStandardCollection,
} from '../../lib/standards.ts';
import { buildQtiPreviewXml } from '../../lib/qti_preview.ts';
import {
  applyDraftListField,
  type DraftListKey,
  type DraftListUpdater,
} from '../drivers/draft_list_field.ts';
import type { ItemEditorProps } from './types.ts';
import {
  type ContentReviewField,
  type ContentReviewRequest,
  ItemEditorContext,
  type ItemEditorState,
} from './context.ts';
import { useDeferredQuestionReview } from './useDeferredQuestionReview.ts';
import { useDriverViews } from './useDriverViews.ts';
import { applyPersistedSettingsChange } from '../drivers/right_rail/settings_rail.ts';
import { stripRailOnlyDraftFields } from '../../lib/types/draft_utils.ts';
import type { DriverSettingsValues } from '../drivers/right_rail/settings_contract.ts';
import {
  type ItemEditorFailureCode,
  type PersistedEditorFieldIssue,
  PublishRequestFailure,
  useItemEditorPersistence,
} from './useItemEditorPersistence.ts';
import { parseItemLanguage } from '../../lib/types/item_language.ts';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import { standaloneInlineChoice } from '../../lib/types/inline_choice.ts';
import { useQuestionPresentation } from './useQuestionPresentation.ts';

export type ItemEditorPresentationFailureCode = ItemEditorFailureCode | 'alignment_failed';

/** Maps closed editor failure codes to request-scoped UI copy. */
export function itemEditorFailureMessage(
  i18n: Pick<I18n, 't'>,
  code: ItemEditorPresentationFailureCode,
): string {
  switch (code) {
    case 'save_failed':
      return i18n.t('editor.saveFailed');
    case 'stale_revision':
      return i18n.t('editor.staleRevision');
    case 'alignment_failed':
      return i18n.t('editor.alignmentFailed');
  }
}

/** Converts closed persistence field issues into localized field highlighting copy. */
export function itemEditorFieldIssues(
  i18n: Pick<I18n, 't'>,
  issues: readonly PersistedEditorFieldIssue[],
): Record<FieldKey, string[]> {
  const map: Record<FieldKey, string[]> = {
    title: [],
    body: [],
    prompt: [],
    choices: [],
    correct: [],
    maximumScore: [],
    minChoices: [],
    maxChoices: [],
    matchSources: [],
    matchTargets: [],
    matchPairs: [],
    order: [],
    textEntry: [],
    general: [],
  };
  const message = i18n.t('editor.fieldInvalid');
  for (const issue of issues) {
    if (!map[issue.field].includes(message)) map[issue.field].push(message);
  }
  return map;
}

function stripHtml(input: string): string {
  if (!input) return '';
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function plainTextValue(text?: string, html?: string): string {
  if (html && html.trim()) return stripHtml(html);
  return text ?? '';
}

function buildItemEditorPersistenceDraft(input: {
  readonly draft: Draft;
  readonly itemId: string | undefined;
  readonly qtype: QuestionTypeId;
  readonly tagsCsv: string;
}): Draft {
  const driver = TYPE_DRIVERS[input.qtype];
  const serialized = stripRailOnlyDraftFields(driver.serialize(input.draft));
  return {
    ...serialized,
    itemId: input.itemId ?? serialized.itemId,
    type: input.qtype,
    tags: input.tagsCsv.split(',').map((tag) => tag.trim()).filter(Boolean),
    standards: normalizeStandardCollection(input.draft.standards),
  };
}

function persistenceFingerprint(draft: Draft): string {
  // The first save assigns identity; that alone is not a new authored edit.
  const { itemId: _itemId, ...content } = draft;
  return canonicalJsonStringify(projectJsonPersistenceObject(content));
}

function useItemEditorModel(props: ItemEditorProps): ItemEditorState {
  const i18n = useI18n();
  const promptId = useDomId();
  const [persistencePhase, setPersistencePhase] = useState<'idle' | 'saving'>('idle');
  const [feedbackUploads, setFeedbackUploads] = useState(0);
  const feedbackUploadsRef = useRef(0);
  function setFeedbackUploadBusy(busy: boolean) {
    feedbackUploadsRef.current += busy ? 1 : -1;
    setFeedbackUploads(feedbackUploadsRef.current);
  }
  const [assistancePending, setAssistancePending] = useState(Boolean(props.textAssistance));
  const [draft, setDraft] = useState<Draft>(() => {
    const rawDraft: Draft = {
      itemLanguage: parseItemLanguage('en-US'),
      ...(props.initialDraft ?? {}),
      type: props.initialType ?? props.initialDraft?.type,
    };
    const { typeId } = resolveDriver(rawDraft);
    return normalizeDraftForDriver(typeId, { ...rawDraft, type: typeId });
  });
  const [titleLocked, setTitleLocked] = useState(() =>
    Boolean(props.initialDraft?.title && props.initialDraft.title.trim().length > 0)
  );
  const setDraftField = <K extends keyof Draft>(
    key: K,
    value: Draft[K] | ((prev: Draft[K]) => Draft[K]),
  ) => {
    setDraft((prev) => {
      const prevValue = prev[key];
      const nextValue = typeof value === 'function'
        ? (value as (prev: Draft[K]) => Draft[K])(prevValue)
        : value;
      if (prevValue === nextValue) return prev;
      return { ...prev, [key]: nextValue };
    });
  };
  const setDraftListField = <K extends DraftListKey>(
    key: K,
    value: DraftListUpdater<K>,
  ) => {
    setDraft((prev) => applyDraftListField(prev, key, value));
  };
  const qtype = draft.type ?? props.initialType ?? 'single_select';
  const points = useQuestionPoints(
    draft,
    qtype,
    setDraft,
    props.pointEditingAuthority,
    i18n,
    props.persistence._tag !== 'Assessment' && persistencePhase === 'saving',
  );
  const title = draft.title ?? '';
  const setTitle = (value: string) => setDraftField('title', value);
  const promptHtml = draft.promptHtml ?? '';
  const setPromptHtml = (value: string | ((prev: string) => string)) =>
    setDraftField(
      'promptHtml',
      typeof value === 'function' ? (prev) => value(prev ?? '') : value,
    );
  const standalone = qtype === 'inline_choice'
    ? standaloneInlineChoice({ bodyHtml: draft.bodyHtml, inlineChoices: draft.inlineChoices ?? [] })
    : null;
  const bodyHtml = standalone?.questionHtml ?? draft.bodyHtml ?? '';
  const setBodyHtml = (value: string | ((prev: string) => string)) =>
    setDraft((current) => {
      const dropdown = current.type === 'inline_choice'
        ? standaloneInlineChoice({
          bodyHtml: current.bodyHtml,
          inlineChoices: current.inlineChoices ?? [],
        })
        : null;
      const previous = dropdown?.questionHtml ?? current.bodyHtml ?? '';
      const next = typeof value === 'function' ? value(previous) : value;
      return { ...current, bodyHtml: `${next}${dropdown?.suffix ?? ''}` };
    });
  const catalogs = draft.catalogs ?? [];
  const setCatalogs = (value: CatalogDraft[]) => setDraftListField('catalogs', value);
  const stylesheets = draft.stylesheets ?? [];
  const setStylesheets = (value: StylesheetDraft[]) => setDraftListField('stylesheets', value);
  const standards = draft.standards ?? [];
  const setStandards = (
    value:
      | CurriculumStandardAlignment[]
      | ((prev: CurriculumStandardAlignment[]) => CurriculumStandardAlignment[]),
  ) => setDraftListField('standards', value);
  const [blueprintTargetId, setBlueprintTargetId] = useState(
    props.initialBlueprintTargetId,
  );
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<PersistedEditorFieldIssue[]>([]);
  const [tagsCsv] = useState('math, sample');
  const [tab, setTab] = useState<'content' | 'preview'>('content');
  const reviewSequence = useRef(0);
  const [contentReview, setContentReview] = useState<ContentReviewRequest | null>(null);
  function reviewContentField(field: ContentReviewField) {
    setTab('content');
    setContentReview({ field, sequence: ++reviewSequence.current });
  }
  function finishContentReview(sequence: number) {
    setContentReview((current) => current?.sequence === sequence ? null : current);
  }
  function selectTab(next: 'content' | 'preview') {
    setContentReview(null);
    setTab(next);
  }
  const useRteForChoices = props.choiceRichText;
  const driver = TYPE_DRIVERS[qtype];
  const { state: driverViews, retry: retryDriverViews } = useDriverViews(qtype);
  const persistenceDraft = useMemo(
    () =>
      buildItemEditorPersistenceDraft({
        draft,
        itemId: props.itemId,
        qtype,
        tagsCsv: props.tagsCsv ?? tagsCsv,
      }),
    [draft, props.itemId, props.tagsCsv, qtype, tagsCsv],
  );
  const currentFingerprint = useMemo(
    () => persistenceFingerprint(persistenceDraft),
    [persistenceDraft],
  );
  const currentFingerprintRef = useRef(currentFingerprint);
  currentFingerprintRef.current = currentFingerprint;
  const manualPersistence = props.persistence._tag === 'Assessment';
  const [choiceHistoryVersion, setChoiceHistoryVersion] = useState(0);
  const presentation = useQuestionPresentation(
    draft,
    setDraft,
    persistencePhase === 'saving' || assistancePending || points.blocked ||
      Boolean(props.authoringSettingsResetting),
    choiceHistoryVersion,
  );
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(() =>
    manualPersistence && props.itemId === undefined ? null : currentFingerprint
  );
  const dirty = feedbackUploads > 0 || points.invalid ||
    manualPersistence && savedFingerprint !== currentFingerprint;
  const saveStatus = persistencePhase === 'saving'
    ? 'saving' as const
    : points.invalid
    ? 'dirty' as const
    : !manualPersistence
    ? 'clean' as const
    : dirty
    ? 'dirty' as const
    : savedId
    ? 'saved' as const
    : 'clean' as const;
  const persistence = useItemEditorPersistence(
    {
      ...props.persistence,
      tagsCsv: props.tagsCsv ?? tagsCsv,
      onAutosaveError: (code) => setError(itemEditorFailureMessage(i18n, code)),
    },
    () => persistenceDraft,
    draft,
  );

  useEffect(() => {
    const presetSettings = props.presetSettings;
    if (!presetSettings || presetSettings.typeId !== qtype) return;
    setDraft((current) => applyPersistedSettingsChange(current, presetSettings));
  }, [props.presetSettings, qtype]);

  const errors = useMemo(() => {
    const activeDriver = TYPE_DRIVERS[qtype];
    if (!activeDriver?.validate) return [];
    return activeDriver.validate(draft);
  }, [draft, qtype]);
  const a11yIssues = useMemo(() => collectA11yIssues(draft), [draft]);
  const reviewSuggestions = useDeferredQuestionReview({
    draft,
    a11yIssues,
    blueprint: props.blueprint,
    blueprintTargetId,
    aiSuggestions: props.aiReviewSuggestions,
    enabled: props.advisoryReviewEnabled ?? true,
  });
  const feedbackInvalid = draft.answerFeedback !== undefined &&
    !parseAnswerFeedback(draft.answerFeedback).ok;
  const canSave = !feedbackInvalid && feedbackUploads === 0 && !points.blocked &&
    !assistancePending && !props.authoringSettingsResetting &&
    errors.length === 0 &&
    !a11yIssues.some((issue) => issue.severity === 'error');
  const showPreviewOnly = props.showPreviewOnly === true;
  const previewXml = useMemo(
    () => {
      if (showPreviewOnly || tab !== 'preview') return null;
      if (points.blocked) {
        return {
          ok: false as const,
          typeId: qtype,
          title,
          issues: [{
            field: 'general' as const,
            message: points.message ?? i18n.t('driver.points.invalid'),
          }],
        };
      }
      return buildQtiPreviewXml(
        { ...draft, type: qtype },
        { identifier: `preview-${qtype}` },
      );
    },
    [draft, qtype, showPreviewOnly, tab, points.blocked, points.message, title, i18n],
  );

  function addStandard() {
    setStandards((prev) => [
      ...prev,
      { standardId: '', code: '', label: '', uri: '', providerId: 'CASE' },
    ]);
  }

  function updateStandard(index: number, patch: Partial<CurriculumStandardAlignment>) {
    setStandards((prev) =>
      prev.map((standard, idx) => (idx === index ? { ...standard, ...patch } : standard))
    );
  }

  function removeStandard(index: number) {
    setStandards((prev) => prev.filter((_standard, idx) => idx !== index));
  }

  async function save() {
    if (!canSave || feedbackUploadsRef.current > 0 || persistencePhase === 'saving') return false;
    if (!manualPersistence) points.lockPublicationInput();
    const submittedPointEdit = points.editVersion();
    const submittedDraft = persistenceDraft;
    const submittedFingerprint = currentFingerprint;
    setPersistencePhase('saving');
    setError(null);
    try {
      const data = await persistence.save({
        draft: submittedDraft,
        ...(blueprintTargetId === undefined ? {} : { blueprintTargetId }),
      });
      setServerIssues([]);
      if (props.onPublish) {
        await props.onPublish({
          itemId: data.itemId,
          rev: data.rev,
          identifier: data.identifier,
        });
      }
      setSavedId(`${data.itemId}/r/${data.rev}`);
      setSavedFingerprint(submittedFingerprint);
      const unchanged = currentFingerprintRef.current === submittedFingerprint &&
        points.editVersion() === submittedPointEdit;
      if (unchanged) setChoiceHistoryVersion((version) => version + 1);
      return unchanged;
    } catch (cause: unknown) {
      if (cause instanceof PublishRequestFailure) {
        setServerIssues([...cause.issues]);
      }
      setError(
        itemEditorFailureMessage(
          i18n,
          cause instanceof PublishRequestFailure ? cause.code : 'save_failed',
        ),
      );
      return false;
    } finally {
      points.unlockPublicationInput();
      setPersistencePhase('idle');
    }
  }

  useEffect(() => {
    if (serverIssues.length === 0) return;
    setServerIssues([]);
  }, [draft]);

  const fieldIssues = useMemo(() => ({
    ...itemEditorFieldIssues(i18n, serverIssues),
    ...(points.blocked && points.message ? { maximumScore: [points.message] } : {}),
  }), [
    i18n,
    serverIssues,
    points.blocked,
    points.message,
  ]);
  const fieldHasIssue = (field: FieldKey) => fieldIssues[field]?.length > 0;
  const fieldIssueText = (field: FieldKey) => fieldIssues[field]?.[0];
  const promptInputValue = useMemo(() => {
    if (!promptHtml) return '';
    if (promptHtml.includes('<')) return stripHtml(promptHtml);
    return promptHtml;
  }, [promptHtml]);
  const renderPromptField = (placeholder: string) => (
    <OptionalInstructionsField
      id={promptId}
      label={i18n.t('editor.optionalInstruction')}
      addLabel={i18n.t('editor.addInstructions')}
      value={promptInputValue}
      placeholder={placeholder}
      issue={fieldIssueText('prompt')}
      onInput={setPromptHtml}
    />
  );

  useEffect(() => {
    if (savedFingerprint === currentFingerprint) return;
    setSavedId(null);
  }, [currentFingerprint, savedFingerprint]);

  useLayoutEffect(() => {
    if (!dirty) return;
    const preventUnsavedUnload = (event: Event) => {
      event.preventDefault();
      // SAFETY: This listener is registered only for the browser's beforeunload event.
      (event as BeforeUnloadEvent).returnValue = '';
    };
    globalThis.addEventListener('beforeunload', preventUnsavedUnload);
    return () => globalThis.removeEventListener('beforeunload', preventUnsavedUnload);
  }, [dirty]);

  const bodyEditorApi = useRef<RichTextEditorApi | null>(null);
  useEffect(() => {
    props.onDraftChange?.({ ...draft, type: qtype });
  }, [draft, qtype]);

  useEffect(() => {
    if (titleLocked) return;
    const auto = autoTitleFromPrompt(promptHtml);
    if (auto === title) return;
    setTitle(auto);
  }, [promptHtml, titleLocked, title]);

  const driverEditor = {
    pointsField: <QuestionPoints />,
    renderPromptField,
    fieldHasIssue,
    fieldIssueText,
    useRteForChoices,
    plainTextValue,
    bodyHtml,
    bodyEditorApi,
    draftKey: props.itemId ?? qtype,
    choiceHistoryKey: String(choiceHistoryVersion),
    settings: props.presetSettings?.values,
    onSettingsChange: props.onSettingsChange
      ? (values: DriverSettingsValues) => props.onSettingsChange?.({ typeId: qtype, values })
      : undefined,
    setDraftField,
    setDraftListField,
  };

  return {
    navigation: {
      showPreviewOnly,
      tab,
      setTab: selectTab,
      contentReview,
      reviewContentField,
      finishContentReview,
    },
    content: {
      points,
      textAssistance: props.textAssistance,
      setAssistancePending,
      setFeedbackUploadBusy,
      feedbackUploading: feedbackUploads > 0,
      playerCatalog: props.playerCatalog,
      payload: props.payload,
      qtype,
      presentation,
      draft,
      setDraft,
      driver,
      driverViews,
      retryDriverViews,
      driverEditor,
      bodyEditorApi,
      bodyHtml,
      setBodyHtml,
      focusQuestionText: props.focusQuestionText,
      catalogs,
    },
    persistence: {
      canSave,
      saveStatus,
      save,
      savedId,
      errors,
      error,
      fieldIssues,
      fieldHasIssue,
      fieldIssueText,
      previewXml,
    },
    inspector: {
      title,
      setTitle,
      titleLocked,
      setTitleLocked,
      standards,
      addStandard,
      updateStandard,
      removeStandard,
      catalogs,
      setCatalogs,
      stylesheets,
      setStylesheets,
      a11yIssues,
      blueprint: props.blueprint,
      blueprintTargetId,
      setBlueprintTargetId: (targetId) => {
        if (targetId && props.onBlueprintTargetChange) {
          props.onBlueprintTargetChange(targetId)
            .then(() => setBlueprintTargetId(targetId))
            .catch(() => {
              setError(itemEditorFailureMessage(i18n, 'alignment_failed'));
            });
          return;
        }
        setBlueprintTargetId(targetId);
      },
      reviewSuggestions,
    },
  };
}

/** Provide one canonical item-editor model to its canvas and optional inspector. */
export default function ItemEditorProvider(
  props: ItemEditorProps & { children: ComponentChildren },
) {
  const { children, ...editorProps } = props;
  const state = useItemEditorModel(editorProps);
  return (
    <ItemEditorContext.Provider value={state}>
      {children}
    </ItemEditorContext.Provider>
  );
}
