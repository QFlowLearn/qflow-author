import { labelForTypeId } from '../../lib/types/registry.ts';
import { useAssessmentPlacementRecovery } from '../../components/assessment_builder/useAssessmentPlacementRecovery.ts';
import type {
  PlacementRemovalReceipt,
  PlacementRemovalResult,
} from '../../lib/assessment_placement_removal.ts';
import { safeErrorSummary } from '../../lib/error_summary.ts';
import {
  assessmentPlacementFollowing,
  insertAssessmentPlacements,
} from '../../lib/assessment_insertion.ts';
import { useRef, useState } from 'preact/hooks';
import { requestAssessmentDeliveryPublication } from '../../lib/client/delivery_publish.ts';
import type { Draft } from '../../lib/types/draft.ts';
import { prepareQuestionXmlDownload } from '../../lib/export/question_xml_download.ts';
import type { QuestionExportNotice } from './QuestionExportFeedback.tsx';
import {
  formatDeliveryPublishError,
  formatDeliveryPublishSuccess,
  formatDeliveryWarningConfirmation,
} from './assessment_delivery.ts';
import type { I18n } from '../../lib/i18n/messages.ts';
import { itemMetaFromDraft } from './assessment_questions.ts';
import type { AuthoringState, DeliverySummary, ItemActionBusy, ItemMeta, Part } from './types.ts';
import type { AssessmentBlueprint } from '../../lib/assessment_blueprint.ts';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import type { ItemEditorSaveCommand } from '../item_editor/types.ts';
import { collectQuestionReviewSuggestions } from '../../lib/question_review.ts';
import {
  parseItemEditorFailureCode,
  parsePersistedFieldIssues,
  PublishRequestFailure,
} from '../item_editor/useItemEditorPersistence.ts';

type Options = {
  assessmentId: string;
  parts: Part[];
  setParts: (update: (prev: Part[]) => Part[]) => void;
  itemMeta: Record<string, ItemMeta>;
  setItemMeta: (
    value:
      | Record<string, ItemMeta>
      | ((prev: Record<string, ItemMeta>) => Record<string, ItemMeta>),
  ) => void;
  authoringState: AuthoringState;
  setAuthoringState: (value: AuthoringState) => void;
  draftRef: { current: Draft | null };
  editItem: (
    itemId: string,
    placementId: string,
    partId: string,
    revision: number,
  ) => Promise<Draft>;
  deliveryPublishAvailable: boolean;
  initialDelivery: DeliverySummary | null | undefined;
  blueprint: AssessmentBlueprint;
  i18n: I18n;
  placementRemovalHistory: PlacementRemovalResult<readonly PlacementRemovalReceipt[]>;
};

type SavedQuestionResponse = {
  readonly itemId: string;
  readonly placementId: string;
  readonly revision: number;
  readonly identifier: string;
  readonly fixed: boolean;
};

async function persistAssessmentQuestion(
  assessmentId: string,
  body: Record<string, unknown>,
): Promise<SavedQuestionResponse> {
  const response = await fetch(`/api/assessments/${assessmentId}/questions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new PublishRequestFailure(
      parseItemEditorFailureCode(response.status, payload),
      parsePersistedFieldIssues(isRecord(payload) ? payload.issues : null),
    );
  }
  if (
    !isRecord(payload) ||
    typeof payload.itemId !== 'string' ||
    typeof payload.placementId !== 'string' ||
    typeof payload.revision !== 'number' ||
    typeof payload.identifier !== 'string' ||
    typeof payload.fixed !== 'boolean'
  ) {
    throw new Error('invalid_response');
  }
  return {
    itemId: payload.itemId,
    placementId: payload.placementId,
    revision: payload.revision,
    identifier: payload.identifier,
    fixed: payload.fixed,
  };
}

export function useAssessmentItemActions(options: Options) {
  const {
    assessmentId,
    setParts,
    itemMeta,
    setItemMeta,
    authoringState,
    setAuthoringState,
    draftRef,
    editItem,
    deliveryPublishAvailable,
    blueprint,
    i18n,
  } = options;
  const latest = useRef(options);
  latest.current = options;
  const variantPending = useRef(false);
  const uncertainCopies = useRef(new Map<string, string>());
  const editing = authoringState._tag === 'Editing' ? authoringState : null;

  const [actionBusy, setActionBusy] = useState<ItemActionBusy>(null);
  const [delivery, setDelivery] = useState(options.initialDelivery);
  const placementRecovery = useAssessmentPlacementRecovery({
    ...options,
    initialHistory: options.placementRemovalHistory,
    actionBusy,
    setActionBusy,
  });
  const [questionExportNotice, setQuestionExportNotice] = useState<QuestionExportNotice | null>(
    null,
  );

  async function saveAssessmentDraft(saveCommand: ItemEditorSaveCommand) {
    const { draft, blueprintTargetId, rememberedSettings } = saveCommand;
    const activeState = authoringState;
    if (activeState._tag !== 'Creating' && activeState._tag !== 'Editing') {
      throw new Error('No question is active for saving.');
    }
    const command = activeState._tag === 'Creating'
      ? {
        operation: 'create',
        beforePlacementId: activeState.beforePlacementId,
        partId: activeState.partId,
        draft,
        rememberedSettings,
        ...(blueprintTargetId === undefined ? {} : { blueprintTargetId }),
      }
      : {
        operation: 'revise',
        expectedParentRevision: activeState.revision,
        itemId: activeState.itemId,
        placementId: activeState.placementId,
        draft,
        rememberedSettings,
        ...(blueprintTargetId === undefined ? {} : { blueprintTargetId }),
      };
    const saved = await persistAssessmentQuestion(assessmentId, command);
    const partId = activeState.partId;
    const savedBlueprintTargetId = blueprintTargetId ??
      (activeState._tag === 'Editing'
        ? itemMeta[activeState.placementId]?.blueprintTargetId
        : undefined);
    setItemMeta((prev) => ({
      ...prev,
      [saved.placementId]: itemMetaFromDraft(
        saved.placementId,
        saved.itemId,
        saved.revision,
        draft,
        { blueprint, blueprintTargetId: savedBlueprintTargetId },
      ),
    }));
    setParts((prev) =>
      prev.map((part) => {
        if (part.id !== partId) return part;
        if (activeState._tag === 'Creating') {
          return {
            ...part,
            placements: insertAssessmentPlacements(part.placements, [{
              id: saved.placementId,
              itemId: saved.itemId,
              snapshotRev: saved.revision,
              fixed: saved.fixed,
              ...(blueprintTargetId === undefined ? {} : { blueprintTargetId }),
            }], activeState.beforePlacementId),
          };
        }
        return {
          ...part,
          placements: part.placements.map((placement) =>
            'itemId' in placement && placement.id === saved.placementId
              ? {
                ...placement,
                snapshotRev: saved.revision,
                fixed: saved.fixed,
                ...(savedBlueprintTargetId === undefined
                  ? {}
                  : { blueprintTargetId: savedBlueprintTargetId }),
              }
              : placement
          ),
        };
      })
    );
    const savedState: AuthoringState = {
      _tag: 'Editing',
      revision: saved.revision,
      pointEditingAuthority: draft.preserveSourceXml === true && activeState._tag === 'Editing'
        ? activeState.pointEditingAuthority
        : { _tag: 'Generated' },
      itemId: saved.itemId,
      placementId: saved.placementId,
      partId,
      draft,
    };
    latest.current = {
      ...latest.current,
      authoringState: savedState,
      itemMeta: {
        ...latest.current.itemMeta,
        [saved.placementId]: itemMetaFromDraft(
          saved.placementId,
          saved.itemId,
          saved.revision,
          draft,
          { blueprint, blueprintTargetId: savedBlueprintTargetId },
        ),
      },
    };
    setAuthoringState(savedState);
    return { itemId: saved.itemId, rev: saved.revision, identifier: saved.identifier };
  }

  function exportQuestionXml() {
    if (!editing || actionBusy) return;
    const workingDraft = draftRef.current;
    if (!workingDraft) return;
    setActionBusy('export');
    try {
      const built = prepareQuestionXmlDownload(workingDraft, `item-${editing.itemId}`);
      if (!built.ok) {
        setQuestionExportNotice({
          _tag: 'NeedsRepair',
          placementId: editing.placementId,
          issues: built.issues,
        });
        return;
      }
      setQuestionExportNotice(
        built.omittedStylesheetCount > 0
          ? {
            _tag: 'OmittedStylesheets',
            placementId: editing.placementId,
            count: built.omittedStylesheetCount,
          }
          : null,
      );
      const xml = built.xml;
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `question-${editing.itemId}.xml`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setQuestionExportNotice({
        _tag: 'NeedsRepair',
        placementId: editing.placementId,
        issues: [{ field: 'general', message: i18n.t('assessments.builder.exportFailed') }],
      });
    } finally {
      setActionBusy(null);
    }
  }

  async function createVariantItem(targetType?: QuestionTypeId) {
    const current = latest.current;
    const source = current.authoringState;
    if (source._tag !== 'Editing' || actionBusy || variantPending.current) return;
    variantPending.current = true;
    setActionBusy('variant');
    try {
      const sourceMeta = current.itemMeta[source.placementId];
      const sourceType = sourceMeta?.questionTypeId;
      if (!sourceType) throw new Error('source_type_missing');
      const typeId = targetType ?? sourceType;
      const partId = source.partId;
      const sourceRevision = sourceMeta.latestRev;
      if (sourceRevision === undefined) {
        throw new Error('revision_missing');
      }
      const command = {
        operation: 'variant',
        partId,
        sourcePlacementId: source.placementId,
        sourceItemId: source.itemId,
        sourceRevision,
        targetType: typeId,
        ...(typeId === sourceType && sourceMeta?.blueprintTargetId
          ? { blueprintTargetId: sourceMeta.blueprintTargetId }
          : {}),
      };
      const identity = JSON.stringify(command);
      const requestId = uncertainCopies.current.get(identity) ?? crypto.randomUUID();
      uncertainCopies.current.set(identity, requestId);
      const saved = await persistAssessmentQuestion(assessmentId, { ...command, requestId });
      uncertainCopies.current.delete(identity);
      const placementId = saved.placementId;
      const committedItemId = saved.itemId;
      const committedRevision = saved.revision;
      // Reflect the committed placement even if its subsequent editor load fails.
      setItemMeta((previous) => ({
        ...previous,
        [placementId]: {
          ...sourceMeta,
          id: placementId,
          itemId: committedItemId,
          latestRev: committedRevision,
          questionTypeId: typeId,
          questionType: labelForTypeId(typeId),
          blueprintTargetId: typeId === sourceType ? sourceMeta.blueprintTargetId : undefined,
          reviewSuggestions: [],
        },
      }));
      setParts((prev) =>
        prev.map((part) => {
          if (part.id !== partId) return part;
          return {
            ...part,
            placements: insertAssessmentPlacements(
              part.placements,
              [{
                id: placementId,
                itemId: committedItemId,
                snapshotRev: committedRevision,
                fixed: saved.fixed,
                ...(typeId === sourceType && sourceMeta?.blueprintTargetId
                  ? { blueprintTargetId: sourceMeta.blueprintTargetId }
                  : {}),
              }],
              assessmentPlacementFollowing(part.placements, source.placementId),
            ),
          };
        })
      );
      try {
        const committedDraft = await editItem(
          committedItemId,
          placementId,
          partId,
          committedRevision,
        );

        setItemMeta((prev) => ({
          ...prev,
          [placementId]: itemMetaFromDraft(
            placementId,
            committedItemId,
            committedRevision,
            committedDraft,
            {
              blueprint,
              blueprintTargetId: typeId === sourceType ? sourceMeta?.blueprintTargetId : undefined,
            },
          ),
        }));
      } catch (cause: unknown) {
        console.error('Saved question copy could not be opened', safeErrorSummary(cause));
        alert(i18n.t('assessments.builder.copySavedOpenFailed'));
      }
    } catch (err) {
      console.error('Failed to create question variant', safeErrorSummary(err));
      alert(i18n.t('assessments.builder.variantFailed'));
    } finally {
      variantPending.current = false;
      setActionBusy(null);
    }
  }

  async function updateBlueprintTarget(targetId: string): Promise<void> {
    if (!editing) throw new Error('no_active_question');
    const response = await fetch(
      `/api/assessments/${assessmentId}/placements/${editing.placementId}?action=align-blueprint-target`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blueprintTargetId: targetId }),
      },
    );
    if (!response.ok) {
      throw new Error('alignment_failed');
    }
    setParts((parts) =>
      parts.map((part) => ({
        ...part,
        placements: part.placements.map((placement) =>
          placement.id === editing.placementId
            ? { ...placement, blueprintTargetId: targetId }
            : placement
        ),
      }))
    );
    setItemMeta((current) => {
      const meta = current[editing.placementId];
      if (!meta) return current;
      return {
        ...current,
        [editing.placementId]: {
          ...meta,
          blueprintTargetId: targetId,
          reviewSuggestions: collectQuestionReviewSuggestions(editing.draft, {
            blueprint,
            blueprintTargetId: targetId,
            aiSuggestions: meta.reviewSuggestions.filter((suggestion) =>
              suggestion.source === 'ai'
            ),
          }),
        },
      };
    });
  }

  async function publishAssessmentForDelivery() {
    if (actionBusy || !deliveryPublishAvailable) return;
    setActionBusy('deliveryPublish');
    try {
      const result = await requestAssessmentDeliveryPublication(assessmentId, {
        formatWarnings: (codes) => formatDeliveryWarningConfirmation(i18n, codes),
      });
      if (result._tag === 'Cancelled') return;
      if (result._tag === 'Failed') {
        alert(formatDeliveryPublishError(i18n, result.payload, result.reason));
        return;
      }
      const data = result.payload;
      setDelivery(data);
      if (data.previewUrl) globalThis.open(data.previewUrl, '_blank', 'noopener,noreferrer');
      alert(formatDeliveryPublishSuccess(i18n, data.assessmentVersionId));
    } catch (err) {
      console.error('Failed to publish assessment for delivery', err);
      alert(i18n.t('list.actions.publish.failure'));
    } finally {
      setActionBusy(null);
    }
  }

  return {
    delivery,
    actionBusy,
    questionExportNotice: questionExportNotice?.placementId === editing?.placementId
      ? questionExportNotice
      : null,
    saveAssessmentDraft,
    exportQuestionXml,
    createVariantItem,
    updateBlueprintTarget,
    deleteItem: placementRecovery.remove,
    placementRecovery,
    publishAssessmentForDelivery,
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
