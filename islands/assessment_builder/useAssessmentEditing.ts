import { createRailDraft, type RailDraft } from '../drivers/right_rail.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import { isQuestionTypeId } from '../../lib/types/registry.ts';
import type { AuthoringState, ItemMeta } from './types.ts';

type EditItemOptions = {
  setSettingsDraft: (draft: RailDraft) => void;
  setAuthoringState: (value: AuthoringState) => void;
  setTags: (tags: string[]) => void;
};

export function createEditItemHandler({
  setSettingsDraft,
  setAuthoringState,
  setTags,
}: EditItemOptions) {
  return async function editItem(
    itemId: string,
    placementId: string,
    partId: string,
    revision: number,
  ) {
    const r = await fetch(`/api/items/${itemId}/revisions/${revision}`);
    if (!r.ok) throw new Error('Question revision could not be loaded.');
    const { draft, pointEditingAuthority } = await parseRevisionDraft(await r.json());
    const typeId = draft.type;
    const railDraft = createRailDraft(typeId, draft);
    setSettingsDraft(railDraft);
    setAuthoringState({
      _tag: 'Editing',
      revision,
      pointEditingAuthority,
      itemId,
      placementId,
      partId,
      draft: railDraft,
    });
    setTags(Array.isArray(draft.tags) ? draft.tags : []);
    return draft;
  };
}

async function parseRevisionDraft(input: unknown) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Question revision response must be an object.');
  }
  const draft = Reflect.get(input, 'draft');
  const type = draft && typeof draft === 'object' && !Array.isArray(draft)
    ? Reflect.get(draft, 'type')
    : undefined;
  if (!isQuestionTypeId(type)) {
    throw new Error('Question revision has an unsupported question type.');
  }
  const [{ parsePersistedDraft }, { parseQuestionPointEditingAuthority }] = await Promise.all([
    import('../../lib/persisted_draft.ts'),
    import('../../lib/question_point_authority.ts'),
  ]);
  return {
    draft: parsePersistedDraft(draft, type),
    pointEditingAuthority: parseQuestionPointEditingAuthority(
      Reflect.get(input, 'pointEditingAuthority'),
    ),
  };
}

/** Presentation text derived for a question in the editing state. */
export type EditingQuestionPresentation = {
  readonly title: string;
  readonly typeLabel: string;
  readonly inspectorLabel: string;
};

/** Builds presentation text for a question known to be in the editing state. */
export function buildEditingQuestionPresentation(
  editing: Extract<AuthoringState, { _tag: 'Editing' }>,
  itemMeta: Record<string, ItemMeta>,
  findItemNumber: (
    partId?: string,
    placementId?: string,
    itemId?: string,
  ) => string | null,
  i18n: I18n,
): EditingQuestionPresentation {
  const title = editing.draft.title ??
    itemMeta[editing.placementId]?.title ?? i18n.t('assessments.builder.untitledItem');
  const itemNumber = findItemNumber(editing.partId, editing.placementId, editing.itemId);
  const inspectorLabel = itemNumber
    ? i18n.t('assessments.builder.questionWithNumber', { number: itemNumber, title })
    : i18n.t('assessments.builder.questionWithoutNumber', { title });
  const typeLabel = i18n.t('assessments.builder.questionTypeLabel', {
    type: editing.draft.type ?? 'other',
  });
  return { title, typeLabel, inspectorLabel };
}
