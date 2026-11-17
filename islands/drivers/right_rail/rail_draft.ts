import type { Draft } from '../../../lib/types/draft.ts';
import type { QuestionTypeId } from '../../../lib/types/registry.ts';
import {
  normalizeDraftForDriver,
  stripRailOnlyDraftFields,
} from '../../../lib/types/draft_utils.ts';
import { parseItemLanguage } from '../../../lib/types/item_language.ts';

export type RailDraft = Draft & {
  allowPins?: boolean;
  textEntryShowIdentifiers?: boolean;
};

export {
  RAIL_ONLY_DRAFT_FIELDS,
  stripRailOnlyDraftFields,
} from '../../../lib/types/draft_utils.ts';

export function createRailDraft(typeId: QuestionTypeId, seed?: Draft): RailDraft {
  const base = normalizeDraftForDriver(typeId, {
    itemLanguage: parseItemLanguage('en-US'),
    ...seed,
    type: typeId,
  });
  // SAFETY: the construction above supplies the required itemLanguage before driver hydration.
  const railDraft: RailDraft = {
    ...stripRailOnlyDraftFields(base as unknown as Draft),
  };
  const allowPins = typeof railDraft.allowPins === 'boolean'
    ? railDraft.allowPins
    : inferAllowPins(typeId, railDraft);
  railDraft.allowPins = allowPins;
  return railDraft;
}

/** Infer whether pinned choices are exposed when shuffle is on and no explicit rail toggle exists. */
export function inferAllowPins(typeId: QuestionTypeId, draft: RailDraft): boolean {
  const shuffleOn = Boolean(draft.shuffle);
  if (!shuffleOn) return false;
  const hasPinned = (() => {
    if (typeId === 'gap_match') return (draft.gapChoices ?? []).some((c) => c.fixed);
    return (draft.choices ?? []).some((c) => c.fixed);
  })();
  return hasPinned;
}
