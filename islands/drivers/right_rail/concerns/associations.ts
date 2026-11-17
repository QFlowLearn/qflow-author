import type { QuestionTypeId } from '../../../../lib/types/registry.ts';
import type { RailDraft } from '../rail_draft.ts';
import {
  associationLimitHelp,
  type ControlPatch,
  isMatchType,
  type RailBuildContext,
  type SettingsAssign,
} from './context.ts';
import type { DriverSettingsValues } from '../settings_contract.ts';

export function associationControls(ctx: RailBuildContext): ControlPatch {
  const { typeId, draft, setDraft } = ctx;
  const isMatch = isMatchType(typeId);
  const isGapMatch = typeId === 'gap_match' || typeId === 'graphic_gap_match';

  if (!isMatch && !isGapMatch) return {};

  return {
    minAssociations: isMatch
      ? { value: draft.minAssociations, onChange: (next) => setDraft({ minAssociations: next }) }
      : undefined,
    maxAssociations: isMatch
      ? { value: draft.maxAssociations, onChange: (next) => setDraft({ maxAssociations: next }) }
      : undefined,
    associationLimitHelp: isMatch ? associationLimitHelp(typeId, ctx.t) : undefined,
    gapMinAssociations: isGapMatch
      ? { value: draft.minAssociations, onChange: (next) => setDraft({ minAssociations: next }) }
      : undefined,
    gapMaxAssociations: isGapMatch
      ? { value: draft.maxAssociations, onChange: (next) => setDraft({ maxAssociations: next }) }
      : undefined,
    gapMinMessage: isGapMatch
      ? {
        value: draft.minAssociationsMessage ?? '',
        onChange: (next) => setDraft({ minAssociationsMessage: next }),
      }
      : undefined,
    gapMaxMessage: isGapMatch
      ? {
        value: draft.maxAssociationsMessage ?? '',
        onChange: (next) => setDraft({ maxAssociationsMessage: next }),
      }
      : undefined,
  };
}

export function associationSettingsFrom(
  typeId: QuestionTypeId,
  draft: RailDraft,
): DriverSettingsValues {
  if (isMatchType(typeId)) {
    return {
      matchMinAssociations: draft.minAssociations,
      matchMaxAssociations: draft.maxAssociations,
    };
  }
  if (typeId === 'gap_match' || typeId === 'graphic_gap_match') {
    return {
      gapMinAssociations: draft.minAssociations,
      gapMaxAssociations: draft.maxAssociations,
      gapMinMessage: draft.minAssociationsMessage ?? '',
      gapMaxMessage: draft.maxAssociationsMessage ?? '',
    };
  }
  return {};
}

export function applyAssociationSettings(
  typeId: QuestionTypeId,
  settings: DriverSettingsValues,
  assign: SettingsAssign,
): void {
  if (isMatchType(typeId)) {
    if ('matchMinAssociations' in settings) {
      assign('minAssociations', settings.matchMinAssociations);
    }
    if ('matchMaxAssociations' in settings) {
      assign('maxAssociations', settings.matchMaxAssociations);
    }
  }
  if (typeId === 'gap_match' || typeId === 'graphic_gap_match') {
    if ('gapMinAssociations' in settings) {
      assign('minAssociations', settings.gapMinAssociations);
    }
    if ('gapMaxAssociations' in settings) {
      assign('maxAssociations', settings.gapMaxAssociations);
    }
    if ('gapMinMessage' in settings) {
      assign('minAssociationsMessage', settings.gapMinMessage ?? '');
    }
    if ('gapMaxMessage' in settings) {
      assign('maxAssociationsMessage', settings.gapMaxMessage ?? '');
    }
  }
}
