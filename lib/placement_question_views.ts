import { projectQuestionPreviewFromDraft, type QuestionPreview } from './question_preview.ts';
import { labelForTypeId } from './types/registry.ts';
import type { Draft } from './types/draft.ts';
import {
  parseQuestionReviewSuggestions,
  type QuestionReviewSuggestion,
} from './question_review_types.ts';
import type { QuestionTypeId } from './types/registry.ts';
import { parseValidPersistedDraft } from './persisted_draft.ts';

/** Identifies the revision displayed by one assessment placement. */
export type PlacementRevisionReference = {
  readonly placementId: string;
  readonly itemId: string;
  readonly revision: number | null;
};

/** Identifies one concrete pinned question revision required by placements. */
export type PinnedPlacementRevisionSelector = {
  readonly itemId: string;
  readonly revision: number;
};

/** Deduplicated latest and pinned revision selectors required by placements. */
export type PlacementRevisionSelection = {
  readonly latestItemIds: readonly string[];
  readonly pinnedRevisions: readonly PinnedPlacementRevisionSelector[];
};

/** Stored revision data needed to resolve placement-owned question content. */
export type PlacementQuestionRevisionRow = {
  readonly itemId: string;
  readonly latestRevisionId: string | null;
  readonly revisionId: string;
  readonly revision: number;
  readonly body: unknown;
  readonly reviewSuggestions: unknown;
};

/** Question content projected for one concrete assessment placement. */
export type PlacementQuestionView = {
  readonly placementId: string;
  readonly itemId: string;
  readonly revision: number;
  readonly title: string;
  readonly questionType: string;
  readonly preview: QuestionPreview;
  readonly draft: Draft;
  readonly reviewSuggestions: readonly QuestionReviewSuggestion[];
};

/** Normalizes placement references into deduplicated latest and pinned revision selectors. */
export function normalizePlacementRevisionSelectors<
  Reference extends Pick<PlacementRevisionReference, 'itemId' | 'revision'>,
>(
  references: ReadonlyArray<Reference>,
): PlacementRevisionSelection {
  const latestItemIds = new Set<string>();
  const pinnedRevisionsByItemId = new Map<string, Set<number>>();

  for (const reference of references) {
    if (reference.revision === null) {
      latestItemIds.add(reference.itemId);
      continue;
    }

    const revisions = pinnedRevisionsByItemId.get(reference.itemId) ?? new Set<number>();
    revisions.add(reference.revision);
    pinnedRevisionsByItemId.set(reference.itemId, revisions);
  }

  const pinnedRevisions: PinnedPlacementRevisionSelector[] = [];
  for (const [itemId, revisions] of pinnedRevisionsByItemId) {
    for (const revision of revisions) {
      pinnedRevisions.push({ itemId, revision });
    }
  }

  return {
    latestItemIds: Array.from(latestItemIds),
    pinnedRevisions,
  };
}

/** Resolves every placement to its pinned revision, or to the explicit latest revision pointer. */
export function projectPlacementQuestionViews(
  references: ReadonlyArray<PlacementRevisionReference>,
  rows: ReadonlyArray<PlacementQuestionRevisionRow>,
): Record<string, PlacementQuestionView> {
  const rowsByQuestion = new Map<string, PlacementQuestionRevisionRow[]>();
  for (const row of rows) {
    const existing = rowsByQuestion.get(row.itemId) ?? [];
    existing.push(row);
    rowsByQuestion.set(row.itemId, existing);
  }

  const views: Record<string, PlacementQuestionView> = {};
  for (const reference of references) {
    const questionRows = rowsByQuestion.get(reference.itemId) ?? [];
    const row = reference.revision === null
      ? questionRows.find((candidate) => candidate.revisionId === candidate.latestRevisionId)
      : questionRows.find((candidate) => candidate.revision === reference.revision);
    if (!row) {
      throw new Error(`Question revision not found for placement ${reference.placementId}`);
    }
    const body = parseQuestionRevisionBody(row.body, reference.placementId);
    views[reference.placementId] = {
      placementId: reference.placementId,
      itemId: reference.itemId,
      revision: row.revision,
      title: body.title,
      questionType: labelForTypeId(body.type),
      preview: projectQuestionPreviewFromDraft(body.draft),
      draft: body.draft,
      reviewSuggestions: parseQuestionReviewSuggestions(row.reviewSuggestions),
    };
  }
  return views;
}

function parseQuestionRevisionBody(
  body: unknown,
  placementId: string,
): { readonly title: string; readonly type: QuestionTypeId; readonly draft: Draft } {
  try {
    const draft = parseValidPersistedDraft(body);
    return { title: draft.title, type: draft.type, draft };
  } catch (cause: unknown) {
    throw new Error(`Question revision is invalid for placement ${placementId}.`, { cause });
  }
}
