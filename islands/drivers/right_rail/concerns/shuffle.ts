import type { QuestionTypeId } from '../../../../lib/types/registry.ts';
import { inferAllowPins, type RailDraft } from '../rail_draft.ts';
import { clearPinnedChoices } from '../pin_helpers.ts';
import type { ControlPatch, RailBuildContext, SettingsAssign } from './context.ts';
import type { DriverSettingsValues } from '../settings_contract.ts';

export function shuffleControls(ctx: RailBuildContext): ControlPatch {
  const { typeId, draft, setDraft, caps } = ctx;
  if (!caps?.shuffle) return {};

  return {
    shuffle: {
      value: Boolean(draft.shuffle),
      onChange: (next) => {
        const patch: Partial<RailDraft> = {
          shuffle: next,
          allowPins: next ? ctx.getDraft().allowPins : false,
        };
        if (!next) Object.assign(patch, clearPinnedChoices(typeId, ctx.getDraft()));
        setDraft(patch);
      },
    },
    allowPins: typeId !== 'order'
      ? {
        value: Boolean(draft.allowPins),
        onChange: (next) => {
          const patch: Partial<RailDraft> = { allowPins: next };
          if (!next) Object.assign(patch, clearPinnedChoices(typeId, ctx.getDraft()));
          setDraft(patch);
        },
      }
      : undefined,
  };
}

export function shuffleSettingsFrom(draft: RailDraft): DriverSettingsValues {
  return {
    shuffle: draft.shuffle,
    allowPins: draft.allowPins,
  };
}

export function applyShuffleSettings(
  typeId: QuestionTypeId,
  draft: RailDraft,
  settings: DriverSettingsValues,
  assign: SettingsAssign,
  skipKeys?: ReadonlySet<keyof RailDraft>,
): void {
  const nextShuffle = settings.shuffle ?? draft.shuffle;
  const nextAllowPins = effectiveAllowPins(typeId, draft, settings, !skipKeys?.has('allowPins'));

  if (settings.shuffle !== undefined) {
    assign('shuffle', settings.shuffle);
  }
  if (settings.allowPins !== undefined) {
    assign('allowPins', settings.allowPins);
  }

  const previousAllowPins = effectiveAllowPins(typeId, draft, {}, !skipKeys?.has('allowPins'));
  const configurationChanged = Boolean(nextShuffle) !== Boolean(draft.shuffle) ||
    nextAllowPins !== previousAllowPins;
  // A full settings snapshot must not erase inactive pins during an unrelated edit.
  if (configurationChanged && (!nextShuffle || !nextAllowPins)) {
    const pinPatch = clearPinnedChoices(typeId, draft);
    for (const [key, value] of Object.entries(pinPatch)) {
      assign(key as keyof RailDraft, value as RailDraft[keyof RailDraft]);
    }
  }
}

function effectiveAllowPins(
  typeId: QuestionTypeId,
  draft: RailDraft,
  settings: DriverSettingsValues,
  includeStoredRailToggle: boolean,
): boolean {
  if (settings.allowPins !== undefined) return settings.allowPins;
  if (includeStoredRailToggle && typeof draft.allowPins === 'boolean') return draft.allowPins;
  return inferAllowPins(typeId, draft);
}
