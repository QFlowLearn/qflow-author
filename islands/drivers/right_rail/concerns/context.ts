import type { Draft } from '../../../../lib/types/draft.ts';
import type { QuestionTypeId, TypeDriver } from '../../../../lib/types/registry.ts';
import type { RightRailControls } from '../types.ts';
import type { ItemLanguageMessages } from '../types.ts';
import type { RailDraft } from '../rail_draft.ts';
import type { I18n } from '../../../../lib/i18n/messages.ts';

export type RailBuildContext = {
  typeId: QuestionTypeId;
  draft: RailDraft;
  getDraft: () => RailDraft;
  setDraft: (patch: Partial<RailDraft>) => void;
  caps: TypeDriver['capabilities'] | undefined;
  scoringTemplates?: TypeDriver['scoringTemplates'];
  itemLanguageMessages: ItemLanguageMessages;
  t: I18n['t'];
  fieldIssueText?: (field: 'minChoices' | 'maxChoices') => string | undefined;
};

export type SettingsAssign = <K extends keyof RailDraft>(key: K, value: RailDraft[K]) => void;

export type ControlPatch = Partial<RightRailControls>;

export function isMatchType(typeId: QuestionTypeId): boolean {
  return typeId === 'match' || typeId === 'associate' || typeId === 'graphic_associate';
}

export function associationLimitHelp(typeId: QuestionTypeId, t?: I18n['t']): string | undefined {
  const translate = t ?? ((id: string) => id);
  if (typeId === 'graphic_associate') {
    return translate('driver.rightRail.associationGraphicHelp');
  }
  if (typeId === 'associate') {
    return translate('driver.rightRail.associationAssociateHelp');
  }
  if (typeId === 'match') {
    return translate('driver.rightRail.associationMatchHelp');
  }
  return undefined;
}

export function asResponseMode(value: string): Draft['responseMode'] {
  return value as Draft['responseMode'];
}
