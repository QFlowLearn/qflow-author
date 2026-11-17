import { createPrintRepairAction } from './assessment_builder/print_repair.ts';
import { useRecentAssessments } from '../lib/client/use_recent_assessments.ts';
import { emptyAssessmentContentDraft } from '../lib/assessment_standalone_content.ts';
import { assessmentRevisionFingerprint } from '../lib/assessment_content.ts';
import { assessmentQuestionPlacements } from '../lib/assessment_content.ts';
import type { AssessmentQuestionPointDefault } from '../lib/assessment_question_defaults.ts';
import { type QuestionStructure, questionStructure } from '../lib/authoring/question_text.ts';
import { insertAssessmentPlacements } from '../lib/assessment_insertion.ts';
import {
  applyAuthoringPreferences,
  type AuthoringPreference,
} from '../lib/authoring_preferences.ts';
import { useAuthoringPreferences } from './assessment_builder/useAuthoringPreferences.ts';
import type { ItemEditorSaveCommand } from './item_editor/types.ts';
import AuthoringPreferenceControls from '../components/assessment_builder/DeferredAuthoringPreferenceControls.tsx';
import AdaptiveAssessmentCanvas from './assessment_builder/DeferredAdaptiveAssessmentCanvas.tsx';
import AssessmentContentFindings from '../components/assessment_builder/AssessmentContentFindings.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type QuestionTypeId } from '../lib/types/registry.ts';
import type { Draft } from '../lib/types/draft.ts';
import { useAddDialogKeyboard } from '../components/assessment_builder/useAddDialogKeyboard.ts';
import AssessmentCanvas from './assessment_builder/AssessmentCanvas.tsx';
import AssessmentInsertTools from './assessment_builder/AssessmentInsertTools.tsx';
import AssessmentDraftGuard, {
  type DraftGuard,
} from '../components/assessment_builder/AssessmentDraftGuard.tsx';
import { useAssessmentInsertion } from './assessment_builder/useAssessmentInsertion.ts';
import AssessmentWorkspace from '../components/ui/AssessmentWorkspace.tsx';
import AssessmentPublication from './assessment_builder/AssessmentPublication.tsx';
import AssessmentRightRail from './assessment_builder/AssessmentRightRail.tsx';
import AssessmentSidebar from './assessment_builder/AssessmentSidebar.tsx';
import AssessmentToolPanel, {
  DeferredAssessmentSettings,
} from './assessment_builder/AssessmentToolPanel.tsx';
import type { BankSelectionResult } from '../lib/assessment_bank_selection.ts';
import {
  assessmentBlueprintAlignments,
  assessmentQuestionContentFindings,
  itemMetaFromDraft,
} from './assessment_builder/assessment_questions.ts';
import {
  createCreatingQuestionPresentation,
  createTextAssistancePresentation,
} from './assessment_builder/authoring_state.ts';
import { AUTHORABLE_QUESTION_TYPE_IDS } from '../lib/authoring/question_type_catalog.ts';
import type { AssessmentView, AuthoringState, ItemMeta } from './assessment_builder/types.ts';
import {
  buildEditingQuestionPresentation,
  createEditItemHandler,
} from './assessment_builder/useAssessmentEditing.ts';
import { useAssessmentItemActions } from './assessment_builder/useAssessmentItemActions.ts';
import QuestionExportFeedback from './assessment_builder/QuestionExportFeedback.tsx';
import AssessmentPlacementRecoveryNotice from '../components/assessment_builder/AssessmentPlacementRecoveryNotice.tsx';
import type {
  PlacementRemovalReceipt,
  PlacementRemovalResult,
} from '../lib/assessment_placement_removal.ts';
import { useAssessmentParts } from '../components/assessment_builder/useAssessmentParts.ts';
import { useAssessmentCanvasMove } from '../components/assessment_builder/useAssessmentCanvasMove.ts';
import { applySettingsChange, settingsFromRailDraft } from './drivers/right_rail/settings_rail.ts';
import { createRailDraft, type RailDraft } from './drivers/right_rail/rail_draft.ts';
import ItemEditorProvider from './item_editor/ItemEditorProvider.tsx';
import { assessBlueprintCoverage } from '../lib/assessment_blueprint.ts';
import { collectBlueprintAlignmentSuggestions } from '../lib/question_review.ts';
import { ASSESSMENT_TOOL_IDS } from '../lib/assessment_authoring_tool.ts';
import type { DeliveryPublishCapability } from '../lib/delivery_publish.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import type { QflowPlayerMessageCatalog } from '../lib/i18n/player_messages/types.ts';
import { I18nProvider, useI18n } from '../lib/i18n/context.tsx';
import type { I18n } from '../lib/i18n/messages.ts';
import { newAuthoringItemLanguage } from '../lib/types/item_language.ts';
import type { InstructorDefaults } from '../lib/instructor_defaults.ts';
import { formatAssessmentPlanLabel } from './assessment_builder/assessment_delivery.ts';

type AssessmentBuilderBaseProps = {
  readonly a: AssessmentView;
  readonly items: Record<string, ItemMeta>;
  readonly choiceRichText: boolean;
  readonly authoringPreferences: readonly AuthoringPreference[];
  readonly instructorDefaults: InstructorDefaults;
  readonly assessmentQuestionPointDefault: AssessmentQuestionPointDefault;
  readonly payload: I18nPayload;
  readonly playerCatalog: QflowPlayerMessageCatalog;
  readonly placementRemovalHistory: PlacementRemovalResult<readonly PlacementRemovalReceipt[]>;
};

/** Serializable assessment-builder input with delivery context only on the export path. */
export type AssessmentBuilderProps =
  & AssessmentBuilderBaseProps
  & (
    | {
      readonly activeTool: null | typeof ASSESSMENT_TOOL_IDS.plan;
    }
    | {
      readonly activeTool: typeof ASSESSMENT_TOOL_IDS.export;
      readonly deliveryCapability: DeliveryPublishCapability;
    }
  );

export default function AssessmentBuilder(props: AssessmentBuilderProps) {
  return (
    <I18nProvider payload={props.payload}>
      <AssessmentBuilderInner {...props} />
    </I18nProvider>
  );
}

function AssessmentBuilderInner(props: AssessmentBuilderProps) {
  const { a, items } = props;
  const i18n: I18n = useI18n();
  const initialType = readLastQuestionType() ?? 'single_select';
  const [adaptiveSetupOpen, setAdaptiveSetupOpen] = useState(false);
  const draftGuard = useRef<DraftGuard | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [assessmentSettingsOpen, setAssessmentSettingsOpen] = useState(false);
  const [assessmentSettingsMounted, setAssessmentSettingsMounted] = useState(false);
  const [assessmentSettingsBlocked, setAssessmentSettingsBlocked] = useState(false);
  const [questionPointDefault, setQuestionPointDefault] = useState(
    props.assessmentQuestionPointDefault,
  );
  const assessmentSettingsTrigger = useRef<HTMLElement | null>(null);
  const inspectorTriggerRef = useRef<HTMLElement | null>(null);
  const [authoringState, setAuthoringState] = useState<AuthoringState>({ _tag: 'Idle' });
  const creationSequence = useRef(0);
  const [editorKey, setEditorKey] = useState('idle');
  const [sessionStructures, setSessionStructures] = useState<readonly QuestionStructure[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const recent = useRecentAssessments(a.id);
  const [settingsDraft, setSettingsDraft] = useState<RailDraft>(() => createRailDraft(initialType));
  const preferences = useAuthoringPreferences(
    a.id,
    props.authoringPreferences,
    props.instructorDefaults,
    questionPointDefault,
  );
  const settingsRef = useRef(settingsDraft);
  settingsRef.current = settingsDraft;
  const draftRef = useRef<Draft | null>(null);
  const tagsCsv = tags.join(', ');
  const [lastType, setLastType] = useState<QuestionTypeId | null>(() => readLastQuestionType());

  const {
    parts,
    setParts,
    captureOrder,
    collapsed,
    togglePart,
    findItemNumber,
  } = useAssessmentParts({
    assessmentId: a.id,
    parts: a.parts,
  });
  const movement = useAssessmentCanvasMove(a.id, captureOrder);
  const insertion = useAssessmentInsertion(parts, authoringState);
  const { open: showAdd, target: insertionTarget } = insertion;
  function openGlobalAdd(value: boolean | ((current: boolean) => boolean)) {
    if (typeof value === 'function' ? value(showAdd) : value) insertion.openSelected();
    else insertion.close();
  }
  async function continueAuthoring(action: () => void | Promise<unknown>) {
    if (draftGuard.current && !await draftGuard.current()) return;
    await action();
  }
  const [itemMeta, setItemMeta] = useState<Record<string, ItemMeta>>({ ...items });
  const contentFindings = useMemo(() => assessmentQuestionContentFindings(parts, itemMeta), [
    parts,
    itemMeta,
  ]);
  const [blueprint, setBlueprint] = useState(a.blueprint);
  const blueprintCoverage = useMemo(
    () =>
      blueprint._tag === 'Defined'
        ? assessBlueprintCoverage(
          blueprint,
          assessmentBlueprintAlignments(parts, itemMeta),
        )
        : undefined,
    [blueprint, itemMeta, parts],
  );
  const deliveryPublishAvailable = props.activeTool === ASSESSMENT_TOOL_IDS.export &&
    props.deliveryCapability.enabled;
  const assessmentPlanLabel = formatAssessmentPlanLabel(i18n, blueprintCoverage);

  const loadItem = useCallback(
    createEditItemHandler({
      setSettingsDraft,
      setAuthoringState,
      setTags,
    }),
    [],
  );

  const editItem: typeof loadItem = async (...args) => {
    const draft = await loadItem(...args);
    setEditorKey(args[1]);
    preferences.begin();
    return draft;
  };

  const {
    actionBusy,
    questionExportNotice,
    saveAssessmentDraft,
    exportQuestionXml,
    createVariantItem,
    updateBlueprintTarget,
    deleteItem,
    placementRecovery,
    publishAssessmentForDelivery,
    delivery,
  } = useAssessmentItemActions({
    assessmentId: a.id,
    parts,
    setParts,
    itemMeta,
    setItemMeta,
    authoringState,
    setAuthoringState,
    draftRef,
    editItem,
    deliveryPublishAvailable,
    initialDelivery: a.delivery,
    blueprint,
    i18n,
    placementRemovalHistory: props.placementRemovalHistory,
  });

  const existingBankItemIds = useMemo(
    () =>
      new Set(
        parts.flatMap((part) =>
          assessmentQuestionPlacements(part.placements).map((placement) => placement.itemId)
        ),
      ),
    [parts],
  );
  const bankQuestionsAdded = useCallback((result: BankSelectionResult) => {
    setItemMeta((current) => {
      const next = { ...current };
      for (const item of result.items) {
        if (!next[item.placementId]) {
          next[item.placementId] = itemMetaFromDraft(
            item.placementId,
            item.itemId,
            item.revision,
            item.draft,
            { blueprint },
          );
        }
      }
      return next;
    });
    setParts((current) =>
      current.map((part) =>
        part.id === result.partId
          ? {
            ...part,
            placements: insertAssessmentPlacements(part.placements, [
              ...result.items
                .filter((item) =>
                  !part.placements.some((placement) => placement.id === item.placementId)
                )
                .map((item) => ({
                  id: item.placementId,
                  itemId: item.itemId,
                  snapshotRev: item.revision,
                })),
            ], insertionTarget?.beforePlacementId),
          }
          : part
      )
    );
  }, [blueprint, setParts, setItemMeta, insertionTarget]);

  const activeType: QuestionTypeId | null = authoringState._tag === 'Creating'
    ? authoringState.type
    : authoringState._tag === 'Editing'
    ? authoringState.draft.type ?? null
    : null;
  const rightRailType = activeType;
  const rightRailSettings = rightRailType
    ? settingsFromRailDraft(rightRailType, settingsDraft)
    : undefined;
  const repairPrint = createPrintRepairAction({
    assessmentId: a.id,
    parts,
    items: itemMeta,
    guard: continueAuthoring,
    openSettings: () => {
      setAssessmentSettingsMounted(true);
      setAssessmentSettingsOpen(true);
    },
    setAuthoring: setAuthoringState,
    edit: editItem,
  });
  const authoring = authoringState._tag === 'Creating' || authoringState._tag === 'Editing';

  const openInspector = useCallback((trigger: HTMLElement) => {
    setAssessmentSettingsOpen(false);
    inspectorTriggerRef.current = trigger;
    setInspectorOpen(true);
  }, []);

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    const trigger = inspectorTriggerRef.current;
    globalThis.setTimeout(() => {
      if (trigger?.isConnected) trigger.focus();
    }, 0);
  }, []);

  const startAuthoring = useCallback((type: QuestionTypeId) => {
    const partId = insertionTarget?.partId;
    if (!partId) return;
    setLastType(type);
    try {
      localStorage.setItem('qflow-last-type', type);
    } catch (_err) {
      /* ignore storage errors */
    }

    const creating = createCreatingQuestionPresentation(i18n, type, partId);
    const railDraft = applyAuthoringPreferences(
      createRailDraft(type),
      type,
      preferences.preferences,
    );
    preferences.begin();
    setSettingsDraft(railDraft);
    setEditorKey(`new-${++creationSequence.current}`);
    if (creating.state._tag !== 'Creating') throw new Error('Expected creation state.');
    setAuthoringState({
      ...creating.state,
      beforePlacementId: insertionTarget?.beforePlacementId,
      // Per-slot options are draft content; flat inspector presets do not carry them.
      ...(type === 'inline_choice'
        ? {
          initialDraft: {
            itemLanguage: railDraft.itemLanguage,
            inlineChoices: railDraft.inlineChoices,
          },
        }
        : railDraft.maximumScore === undefined
        ? {}
        : {
          initialDraft: {
            itemLanguage: railDraft.itemLanguage,
            maximumScore: railDraft.maximumScore,
          },
        }),
    });
    insertion.finish();
  }, [i18n, insertionTarget, preferences.preferences]);

  function startTextAuthoring() {
    const structure = sessionStructures.at(-1) ??
      { type: 'single_select' as const, choiceCount: 4 };
    const partId = insertionTarget?.partId;
    if (!partId) return;
    const presentation = createTextAssistancePresentation(structure, preferences.preferences, {
      partId,
      beforePlacementId: insertionTarget?.beforePlacementId,
    });
    preferences.begin();
    setSettingsDraft(presentation.settings);
    setEditorKey(`new-${++creationSequence.current}`);
    setAuthoringState(presentation.state);
    insertion.finish();
  }

  useAddDialogKeyboard(
    showAdd,
    openGlobalAdd,
    (type) => continueAuthoring(() => startAuthoring(type)),
    !a.adaptivePlan && !adaptiveSetupOpen,
  );

  useEffect(() => {
    if (authoringState._tag === 'Idle') setInspectorOpen(false);
  }, [authoringState._tag]);

  const editingState = authoringState._tag === 'Editing' ? authoringState : null;
  const editingPresentation = editingState
    ? buildEditingQuestionPresentation(editingState, itemMeta, findItemNumber, i18n)
    : null;

  function changeSettings(next: RailDraft) {
    if (!next.type) return;
    preferences.record(next.type, settingsRef.current, next);
    settingsRef.current = next;
    setSettingsDraft(next);
  }

  async function saveWithPreferences(command: ItemEditorSaveCommand) {
    const captured = preferences.capture();
    const saved = await saveAssessmentDraft({ ...command, rememberedSettings: captured.patch });
    if (command.draft.type) preferences.committed(command.draft.type, captured);
    if (authoringState._tag === 'Creating') {
      const structure = questionStructure(command.draft);
      if (structure) setSessionStructures((entries) => [...entries, structure].slice(-5));
    }
    return saved;
  }

  const handleDraftChange = useCallback((next: Draft) => {
    draftRef.current = next;
    if (
      (authoringState._tag === 'Creating' || authoringState._tag === 'Editing') && next.type &&
      next.type !==
        (authoringState._tag === 'Creating' ? authoringState.type : authoringState.draft.type)
    ) {
      setAuthoringState(
        authoringState._tag === 'Creating'
          ? { ...authoringState, type: next.type }
          : { ...authoringState, draft: next },
      );
      preferences.begin({ preserveRemember: true });
      const settings = createRailDraft(next.type, next);
      settingsRef.current = settings;
      setSettingsDraft(settings);
    }
    preferences.observeDropdownDraft(next);
  }, [authoringState, preferences.preferences]);

  const canvas = (
    <AssessmentInsertTools
      insertion={insertion}
      parts={parts}
      assessment={a}
      existingItemIds={existingBankItemIds}
      onAdded={bankQuestionsAdded}
      previewContext={{ payload: props.payload, playerCatalog: props.playerCatalog }}
      lastType={lastType}
      onStartAuthoring={(type) => continueAuthoring(() => startAuthoring(type))}
      onStartText={() => continueAuthoring(startTextAuthoring)}
      onReloadControls={() => continueAuthoring(() => globalThis.location.reload())}
      onStartContent={(target, kind) =>
        continueAuthoring(() => {
          setInspectorOpen(false);
          setAssessmentSettingsOpen(false);
          setAuthoringState({
            _tag: 'CreatingContent',
            initialDraft: emptyAssessmentContentDraft(
              kind,
              i18n.locale,
              i18n.t('assessments.contentEditor.networkNotice'),
            ),
            ...target,
            placementId: crypto.randomUUID(),
          });
          insertion.finish();
        })}
    >
      <AssessmentPlacementRecoveryNotice
        recovery={placementRecovery}
        busy={actionBusy !== null}
        i18n={i18n}
        onReload={() => continueAuthoring(() => globalThis.location.reload())}
      />
      {questionExportNotice && (
        <QuestionExportFeedback
          notice={questionExportNotice}
          i18n={i18n}
          onOpenSettings={openInspector}
        />
      )}
      <AssessmentCanvas
        movement={{
          ...movement,
          blocked: movement.blocked || assessmentSettingsOpen || assessmentSettingsBlocked ||
            (authoringState._tag === 'EditingContent' || authoringState._tag === 'CreatingContent'),
        }}
        onReloadSavedOrder={() => continueAuthoring(() => globalThis.location.reload())}
        contentEditor={{
          assessmentId: a.id,
          captureOrder,
          guard: draftGuard,
          onClose: () => continueAuthoring(() => setAuthoringState({ _tag: 'Idle' })),
          onReload: () => continueAuthoring(() => globalThis.location.reload()),
          onSelected: (partId, placement) =>
            setAuthoringState({ _tag: 'EditingContent', partId, placement }),
          onRemoved: () => setAuthoringState({ _tag: 'Idle' }),
        }}
        onEditContent={(partId, placement) =>
          continueAuthoring(() => {
            if (movement.blocked || assessmentSettingsBlocked || actionBusy) return;
            setInspectorOpen(false);
            setAssessmentSettingsOpen(false);
            setAuthoringState({ _tag: 'EditingContent', partId, placement });
          })}
        authoringState={authoringState}
        editingPresentation={editingPresentation}
        actionBusy={actionBusy}
        parts={parts}
        itemMeta={itemMeta}
        inspectorOpen={inspectorOpen}
        onEditItem={(...args) => continueAuthoring(() => editItem(...args))}
        onOpenInspector={openInspector}
        onAddQuestion={insertion.openAt}
        onCreateVariant={(type) => continueAuthoring(() => createVariantItem(type))}
        onExportXml={exportQuestionXml}
        onDelete={() => continueAuthoring(deleteItem)}
      />
    </AssessmentInsertTools>
  );

  const creatingPresentation = authoringState._tag === 'Creating'
    ? createCreatingQuestionPresentation(i18n, authoringState.type, authoringState.partId)
    : null;
  const questionLabel = creatingPresentation
    ? creatingPresentation.questionLabel
    : editingPresentation?.inspectorLabel;
  const rightRail = questionLabel
    ? (
      <AssessmentRightRail
        open={inspectorOpen}
        questionLabel={questionLabel}
        rightRailType={rightRailType}
        settingsDraft={settingsDraft}
        onSettingsDraftChange={changeSettings}
        tags={tags}
        onTagsChange={setTags}
        onClose={closeInspector}
      >
        {rightRailType && (
          <AuthoringPreferenceControls
            remember={preferences.remember}
            onRememberChange={preferences.setRemember}
            resetState={preferences.resetState}
            onReset={() => preferences.reset(rightRailType)}
            instructorDefaults={props.instructorDefaults}
            assessmentQuestionPointDefault={questionPointDefault}
            questionType={rightRailType}
          />
        )}
      </AssessmentRightRail>
    )
    : null;

  return (
    <AssessmentWorkspace
      assessment={{ ...a, delivery }}
      assessmentPlanLabel={assessmentPlanLabel}
      revisionFingerprint={assessmentRevisionFingerprint(parts, itemMeta)}
      onToggleAdd={a.adaptivePlan || adaptiveSetupOpen ? undefined : () => openGlobalAdd(true)}
      settingsOpen={assessmentSettingsOpen}
      settingsDisabled={movement.blocked ||
        (authoringState._tag === 'EditingContent' || authoringState._tag === 'CreatingContent')}
      settingsUnsaved={assessmentSettingsBlocked}
      onOpenSettings={(trigger) => {
        if (movement.blocked) return;
        assessmentSettingsTrigger.current = trigger;
        setInspectorOpen(false);
        setAssessmentSettingsMounted(true);
        setAssessmentSettingsOpen(true);
      }}
      inspector={assessmentSettingsMounted && (
        <DeferredAssessmentSettings
          open={assessmentSettingsOpen}
          assessment={a}
          parts={parts}
          items={itemMeta}
          captureOrder={captureOrder}
          questionPointDefault={questionPointDefault}
          onQuestionPointDefaultConfirmed={setQuestionPointDefault}
          returnFocusRef={assessmentSettingsTrigger}
          onClose={() => setAssessmentSettingsOpen(false)}
          onBlockedChange={setAssessmentSettingsBlocked}
          guardQuestionDraft={async () => !draftGuard.current || await draftGuard.current()}
        />
      )}
    >
      <AssessmentContentFindings findings={contentFindings} />
      {props.activeTool === ASSESSMENT_TOOL_IDS.plan && (
        <AssessmentToolPanel
          activeTool={props.activeTool}
          assessmentId={a.id}
          blueprint={blueprint}
          coverage={blueprintCoverage}
          payload={props.payload}
          onBlueprintSaved={(savedBlueprint) => {
            setBlueprint(savedBlueprint);
            setItemMeta((current) =>
              Object.fromEntries(
                Object.entries(current).map(([placementId, meta]) => [
                  placementId,
                  {
                    ...meta,
                    reviewSuggestions: [
                      ...meta.reviewSuggestions.filter((suggestion) =>
                        suggestion.category !== 'alignment'
                      ),
                      ...collectBlueprintAlignmentSuggestions({
                        type: meta.questionTypeId,
                        itemLanguage: newAuthoringItemLanguage(),
                      }, {
                        blueprint: savedBlueprint,
                        blueprintTargetId: meta.blueprintTargetId,
                      }),
                    ],
                  },
                ]),
              )
            );
          }}
        />
      )}
      {!a.adaptivePlan && props.activeTool === ASSESSMENT_TOOL_IDS.export && (
        <AssessmentToolPanel
          activeTool={props.activeTool}
          assessmentId={a.id}
          revisionFingerprint={assessmentRevisionFingerprint(parts, itemMeta)}
          onRepairPrint={repairPrint}
          deliveryCapability={props.deliveryCapability}
          publishedVersionId={a.delivery?.assessmentVersionId}
          busy={actionBusy === 'deliveryPublish'}
          onPublish={publishAssessmentForDelivery}
        />
      )}
      {a.adaptivePlan
        ? (
          <>
            <AdaptiveAssessmentCanvas
              assessment={a}
              items={itemMeta}
              payload={props.payload}
              playerCatalog={props.playerCatalog}
            />
            <AssessmentPublication assessment={a}>
              {props.activeTool === ASSESSMENT_TOOL_IDS.export && (
                <AssessmentToolPanel
                  activeTool={props.activeTool}
                  assessmentId={a.id}
                  revisionFingerprint={assessmentRevisionFingerprint(parts, itemMeta)}
                  onRepairPrint={repairPrint}
                  deliveryCapability={props.deliveryCapability}
                  publishedVersionId={a.delivery?.assessmentVersionId}
                  busy={actionBusy === 'deliveryPublish'}
                  onPublish={publishAssessmentForDelivery}
                />
              )}
            </AssessmentPublication>
          </>
        )
        : (
          <>
            {parts.every((part) => part.placements.length === 0) && (
              <AdaptiveAssessmentCanvas
                assessment={a}
                items={itemMeta}
                payload={props.payload}
                playerCatalog={props.playerCatalog}
                onSetupChange={setAdaptiveSetupOpen}
              />
            )}
            {!adaptiveSetupOpen && (
              <div class='grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]'>
                <div class='hidden lg:block'>
                  <AssessmentSidebar
                    assessmentId={a.id}
                    parts={parts}
                    collapsed={collapsed}
                    recent={recent}
                    onTogglePart={togglePart}
                  />
                </div>
                {authoring
                  ? (
                    <ItemEditorProvider
                      pointEditingAuthority={authoringState._tag === 'Editing'
                        ? authoringState.pointEditingAuthority
                        : { _tag: 'Generated' }}
                      key={editorKey}
                      choiceRichText={props.choiceRichText}
                      playerCatalog={props.playerCatalog}
                      payload={props.payload}
                      initialType={authoringState._tag === 'Creating'
                        ? authoringState.type
                        : editingState?.draft.type}
                      initialDraft={authoringState._tag === 'Creating'
                        ? authoringState.initialDraft
                        : editingState?.draft}
                      textAssistance={authoringState._tag === 'Creating' &&
                          authoringState.textAssistance
                        ? {
                          onPrepared: (draft) => {
                            if (!draft.type) return;
                            const next = createRailDraft(draft.type, draft);
                            settingsRef.current = next;
                            setSettingsDraft(next);
                          },
                          assessmentId: a.id,
                          recent: sessionStructures,
                          preferences: preferences.preferences,
                        }
                        : undefined}
                      itemId={editingState?.itemId}
                      focusQuestionText={authoringState._tag === 'Creating' &&
                        !authoringState.textAssistance}
                      persistence={{ _tag: 'Assessment', save: saveWithPreferences }}
                      authoringSettingsResetting={preferences.resetState === 'resetting'}
                      onDraftChange={handleDraftChange}
                      presetSettings={rightRailSettings}
                      onSettingsChange={(settings) =>
                        changeSettings(applySettingsChange(settingsRef.current, settings))}
                      tagsCsv={tagsCsv}
                      blueprint={blueprint}
                      initialBlueprintTargetId={editingState
                        ? itemMeta[editingState.placementId]?.blueprintTargetId
                        : undefined}
                      aiReviewSuggestions={editingState
                        ? itemMeta[editingState.placementId]?.reviewSuggestions.filter((
                          suggestion,
                        ) =>
                          suggestion.source === 'ai'
                        )
                        : undefined}
                      advisoryReviewEnabled={inspectorOpen}
                      onBlueprintTargetChange={editingState ? updateBlueprintTarget : undefined}
                    >
                      <AssessmentDraftGuard guard={draftGuard} />
                      {canvas}
                      {rightRail}
                    </ItemEditorProvider>
                  )
                  : (
                    <>
                      {canvas}
                      {rightRail}
                    </>
                  )}
              </div>
            )}
          </>
        )}
    </AssessmentWorkspace>
  );
}

function readLastQuestionType(): QuestionTypeId | null {
  try {
    const raw = localStorage.getItem('qflow-last-type');
    return raw && AUTHORABLE_QUESTION_TYPE_IDS.has(raw as QuestionTypeId)
      ? raw as QuestionTypeId
      : null;
  } catch (_cause: unknown) {
    return null;
  }
}
