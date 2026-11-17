import type { RailDraft } from '../rail_draft.ts';
import {
  asResponseMode,
  type ControlPatch,
  type RailBuildContext,
  type SettingsAssign,
} from './context.ts';
import type { DriverSettingsValues } from '../settings_contract.ts';
import { validateItemLanguage } from '../../../../lib/types/item_language.ts';

export function coreControls(ctx: RailBuildContext): ControlPatch {
  const { draft, setDraft, caps, scoringTemplates } = ctx;
  return {
    itemLanguage: {
      value: draft.itemLanguage,
      messages: {
        label: ctx.itemLanguageMessages.label,
        help: ctx.itemLanguageMessages.help,
        required: ctx.itemLanguageMessages.required,
        invalid: ctx.itemLanguageMessages.invalid,
      },
      onCommit: (next) => {
        const result = validateItemLanguage(next);
        if (result.ok) setDraft({ itemLanguage: result.value });
        return result;
      },
    },
    required: caps?.required
      ? { value: Boolean(draft.required), onChange: (next) => setDraft({ required: next }) }
      : undefined,
    answerMasking: caps?.answerMasking
      ? {
        value: Boolean(draft.answerMasking),
        onChange: (next) => setDraft({ answerMasking: next }),
      }
      : undefined,
    responseMode: scoringTemplates?.length
      ? {
        value: draft.responseMode ?? scoringTemplates[0].id ?? 'all_or_nothing',
        options: scoringTemplates.map((template) => ({
          value: template.id,
          label: ctx.t(
            ({
              all_or_nothing: 'driver.rightRail.scoringTemplate.all_or_nothing.label',
              partial: 'driver.rightRail.scoringTemplate.partial.label',
              custom: 'driver.rightRail.scoringTemplate.custom.label',
            } as const)[template.id as 'all_or_nothing' | 'partial' | 'custom'] ??
              'driver.rightRail.scoringTemplate.generic.label',
          ),
          description: ctx.t(
            ({
              all_or_nothing: 'driver.rightRail.scoringTemplate.all_or_nothing.description',
              partial: 'driver.rightRail.scoringTemplate.partial.description',
              custom: 'driver.rightRail.scoringTemplate.custom.description',
            } as const)[template.id as 'all_or_nothing' | 'partial' | 'custom'] ??
              'driver.rightRail.scoringTemplate.generic.description',
          ),
          disabled: template.disabled,
        })),
        onChange: (next) => setDraft({ responseMode: asResponseMode(next) }),
      }
      : undefined,
  };
}

export function coreSettingsFrom(draft: RailDraft): DriverSettingsValues {
  return {
    itemLanguage: draft.itemLanguage,
    responseMode: draft.responseMode,
    required: draft.required,
    answerMasking: draft.answerMasking,
    textEntryShowIdentifiers: draft.textEntryShowIdentifiers,
    requirePattern: draft.requirePattern,
    sharedVocabulary: draft.sharedVocabulary,
  };
}

export function applyCoreSettings(
  settings: DriverSettingsValues,
  assign: SettingsAssign,
): void {
  if (settings.itemLanguage !== undefined) {
    assign('itemLanguage', settings.itemLanguage);
  }
  if (settings.responseMode !== undefined) {
    assign('responseMode', settings.responseMode);
  }
  if (settings.required !== undefined) {
    assign('required', settings.required);
  }
  if (settings.answerMasking !== undefined) {
    assign('answerMasking', settings.answerMasking);
  }
  if ('sharedVocabulary' in settings) {
    assign('sharedVocabulary', settings.sharedVocabulary);
  }
}

export function textEntryControls(ctx: RailBuildContext): ControlPatch {
  if (ctx.typeId !== 'text_entry') return {};
  const { draft, setDraft } = ctx;
  return {
    textEntryShowIdentifiers: {
      value: Boolean(draft.textEntryShowIdentifiers),
      onChange: (next) => setDraft({ textEntryShowIdentifiers: next }),
    },
    textEntryRequirePattern: {
      value: Boolean(draft.requirePattern),
      onChange: (next) => setDraft({ requirePattern: next }),
    },
  };
}

export function applyTextEntrySettings(
  typeId: string,
  settings: DriverSettingsValues,
  assign: SettingsAssign,
): void {
  if (typeId !== 'text_entry') return;
  if (settings.textEntryShowIdentifiers !== undefined) {
    assign('textEntryShowIdentifiers', settings.textEntryShowIdentifiers);
  }
  if (settings.requirePattern !== undefined) {
    assign('requirePattern', settings.requirePattern);
  }
}
