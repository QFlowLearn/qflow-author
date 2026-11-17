import type { ComponentChildren, VNode } from 'preact';
import type { Draft } from '../../lib/types/draft.ts';
import type { FieldKey } from '../../lib/validation_fields.ts';
import type { DraftListKeyFor, DraftListUpdaterFor } from './draft_list_field.ts';
import type { TextEntryBlankInput } from '../RichTextEditor.tsx';
import type { DriverSettingsValues } from './right_rail/settings_contract.ts';

export type Choice = {
  id: string;
  text?: string;
  html?: string;
  fixed?: boolean;
  label?: string;
  matchMax?: number;
};

export type LabelEditingState = { id: string; value: string } | null;

export type CommonContentProps = {
  renderPromptField: (placeholder: string) => VNode;
  fieldHasIssue: (field: FieldKey) => boolean;
  fieldIssueText: (field: FieldKey) => string | undefined;
};

export type DriverEditorShell<D extends object = Draft> = CommonContentProps & {
  /** First-pass scoring control owned by the authoring shell. */
  pointsField?: ComponentChildren;
  useRteForChoices?: boolean;
  plainTextValue?: (text?: string, html?: string) => string;
  settings?: DriverSettingsValues;
  onSettingsChange?: (settings: DriverSettingsValues) => void;
  draftKey?: string | number;
  /** Successful save boundary for local answer-option history. */
  choiceHistoryKey?: string | null;
  bodyEditorApi?: {
    current?: {
      insertHtml?: (html: string) => void;
      insertTextEntryBlank?: (blank: TextEntryBlankInput) => void;
    } | null;
  };
  setDraftField?: <K extends keyof D>(
    key: K,
    value: D[K] | ((prev: D[K]) => D[K]),
  ) => void;
  setDraftListField?: <K extends DraftListKeyFor<D>>(
    key: K,
    value: DraftListUpdaterFor<D, K>,
  ) => void;
};
