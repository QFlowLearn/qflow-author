import { type QuestionTypeId, TYPE_DRIVERS } from '../../../../lib/types/registry.ts';
import type { RailDraft } from '../rail_draft.ts';
import type { ControlPatch, RailBuildContext, SettingsAssign } from './context.ts';
import { selectPointCardinalityPolicy } from '../../../../lib/types/select_point_cardinality.ts';
import type { DriverSettingsValues } from '../settings_contract.ts';

export function normalizeUnlimitedMax(next?: number): number | undefined {
  return next === 0 ? undefined : next;
}

export function applySelectionMaxLimit(
  typeId: QuestionTypeId,
  draft: RailDraft,
  next?: number,
): Partial<RailDraft> {
  const normalized = normalizeUnlimitedMax(next);
  switch (typeId) {
    case 'hotspot':
    case 'hottext':
      return {
        maxChoices: normalized,
        correctIds: normalized === 1 && draft.correctIds && draft.correctIds.length > 1
          ? draft.correctIds.slice(0, 1)
          : draft.correctIds,
      };
    case 'select_point': {
      const selectPointMax = selectPointCardinalityPolicy(next).maxChoices;
      return {
        maxChoices: selectPointMax,
        selectPointCorrectPoints: selectPointMax === 1 && draft.selectPointCorrectPoints &&
            draft.selectPointCorrectPoints.length > 1
          ? draft.selectPointCorrectPoints.slice(0, 1)
          : draft.selectPointCorrectPoints,
      };
    }
    case 'position_object':
      return {
        maxChoices: normalized,
        positionCorrectPoints: normalized === 1 && draft.positionCorrectPoints &&
            draft.positionCorrectPoints.length > 1
          ? draft.positionCorrectPoints.slice(0, 1)
          : draft.positionCorrectPoints,
      };
    default:
      return { maxChoices: normalized };
  }
}

export function selectionControls(ctx: RailBuildContext): ControlPatch {
  const { typeId, draft, setDraft, caps } = ctx;
  if (!caps?.minMaxChoices) return {};

  const hasSelectionMessages = typeId === 'hotspot' || typeId === 'hottext';

  return {
    minChoices: {
      value: draft.minChoices,
      issue: ctx.fieldIssueText?.('minChoices'),
      onChange: (next) => setDraft({ minChoices: next }),
    },
    maxChoices: {
      value: draft.maxChoices,
      issue: ctx.fieldIssueText?.('maxChoices'),
      onChange: (next) => setDraft(applySelectionMaxLimit(typeId, ctx.getDraft(), next)),
    },
    selectionMinMessage: hasSelectionMessages
      ? {
        value: draft.minChoicesMessage ?? '',
        onChange: (next) => setDraft({ minChoicesMessage: next }),
      }
      : undefined,
    selectionMaxMessage: hasSelectionMessages
      ? {
        value: draft.maxChoicesMessage ?? '',
        onChange: (next) => setDraft({ maxChoicesMessage: next }),
      }
      : undefined,
  };
}

export function selectionSettingsFrom(
  typeId: QuestionTypeId,
  draft: RailDraft,
): DriverSettingsValues {
  if (!TYPE_DRIVERS[typeId].capabilities?.minMaxChoices) return {};
  const values: DriverSettingsValues = {
    minChoices: draft.minChoices,
    maxChoices: draft.maxChoices,
  };
  if (typeId === 'hottext' || typeId === 'hotspot') {
    return {
      ...values,
      selectionMinMessage: draft.minChoicesMessage ?? '',
      selectionMaxMessage: draft.maxChoicesMessage ?? '',
    };
  }
  return values;
}

export function applySelectionSettings(
  typeId: QuestionTypeId,
  draft: RailDraft,
  settings: DriverSettingsValues,
  assign: SettingsAssign,
): void {
  if (!TYPE_DRIVERS[typeId].capabilities?.minMaxChoices) return;

  if ('minChoices' in settings) {
    assign('minChoices', settings.minChoices);
  }
  if ('maxChoices' in settings) {
    const patch = applySelectionMaxLimit(typeId, draft, settings.maxChoices);
    for (const [key, value] of Object.entries(patch)) {
      assign(key as keyof RailDraft, value as RailDraft[keyof RailDraft]);
    }
  }
  if (typeId === 'hottext' || typeId === 'hotspot') {
    if ('selectionMinMessage' in settings) {
      assign('minChoicesMessage', settings.selectionMinMessage ?? '');
    }
    if ('selectionMaxMessage' in settings) {
      assign('maxChoicesMessage', settings.selectionMaxMessage ?? '');
    }
  }
}
