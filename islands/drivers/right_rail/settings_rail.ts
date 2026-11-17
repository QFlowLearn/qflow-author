import type { Draft } from '../../../lib/types/draft.ts';
import type { QuestionTypeId } from '../../../lib/types/registry.ts';
import {
  RAIL_ONLY_DRAFT_FIELD_SET,
  stripRailOnlyDraftFields,
} from '../../../lib/types/draft_utils.ts';
import type { RailDraft } from './rail_draft.ts';
import { applyAssociationSettings, associationSettingsFrom } from './concerns/associations.ts';
import { applyCoreSettings, applyTextEntrySettings, coreSettingsFrom } from './concerns/core.ts';
import { applyExtendedTextSettings, extendedTextSettingsFrom } from './concerns/extended_text.ts';
import { applySelectionSettings, selectionSettingsFrom } from './concerns/selection_limits.ts';
import { applyShuffleSettings, shuffleSettingsFrom } from './concerns/shuffle.ts';
import {
  applyMediaSettings,
  applyPortableSettings,
  applySliderSettings,
  applyUploadSettings,
  mediaSettingsFrom,
  portableSettingsFrom,
  sliderSettingsFrom,
  uploadSettingsFrom,
} from './concerns/type_specific.ts';
import type { SettingsAssign } from './concerns/context.ts';
import type { DriverSettingsUpdate } from './settings_contract.ts';

export function settingsFromRailDraft(
  typeId: QuestionTypeId,
  draft: RailDraft,
): DriverSettingsUpdate {
  return {
    typeId,
    values: {
      ...(typeId === 'inline_choice' ? {} : shuffleSettingsFrom(draft)),
      ...coreSettingsFrom(draft),
      ...selectionSettingsFrom(typeId, draft),
      ...associationSettingsFrom(typeId, draft),
      ...(typeId === 'media' ? mediaSettingsFrom(draft) : {}),
      ...(typeId === 'slider' ? sliderSettingsFrom(draft) : {}),
      ...(typeId === 'extended_text' ? extendedTextSettingsFrom(draft) : {}),
      ...(typeId === 'upload' ? uploadSettingsFrom(draft) : {}),
      ...(typeId === 'portable_custom' ? portableSettingsFrom(draft) : {}),
    },
  };
}

/** Apply settings that belong on persisted question drafts (not rail-only UI fields). */
export function applyPersistedSettingsChange(
  draft: Draft,
  update: DriverSettingsUpdate,
): Draft {
  const next = applySettingsChange(draft as RailDraft, update, RAIL_ONLY_DRAFT_FIELD_SET);
  return stripRailOnlyDraftFields(next);
}

export function applySettingsChange(
  draft: RailDraft,
  update: DriverSettingsUpdate,
  skipKeys?: ReadonlySet<keyof RailDraft>,
): RailDraft {
  const { typeId, values: settings } = update;
  if (draft.type !== typeId) {
    throw new Error(`Cannot apply ${typeId} settings to ${draft.type ?? 'untyped'} draft.`);
  }
  const next: RailDraft = { ...draft };
  let changed = false;

  const assign: SettingsAssign = (key, value) => {
    if (skipKeys?.has(key)) return;
    if (next[key] === value) return;
    next[key] = value;
    changed = true;
  };

  applyShuffleSettings(typeId, draft, settings, assign, skipKeys);
  applyCoreSettings(settings, assign);
  applySelectionSettings(typeId, draft, settings, assign);
  applyAssociationSettings(typeId, settings, assign);
  applyTextEntrySettings(typeId, settings, assign);
  applySliderSettings(typeId, settings, assign);
  applyExtendedTextSettings(typeId, settings, assign);
  applyUploadSettings(typeId, settings, assign);
  applyMediaSettings(typeId, settings, assign);
  applyPortableSettings(typeId, draft, settings, assign);

  return changed ? next : draft;
}
