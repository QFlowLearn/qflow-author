import type { GapMatchSlotExtension } from './gap_match_slot_extension.ts';
import type { HottextSlotExtension } from './hottext_slot_extension.ts';
import type { InlineChoiceSlotExtension } from './inline_choice_slot_extension.ts';
import type { QFlowBasicExtension } from './qflow_basic_extension.ts';
import type { TextEntryBlankExtension } from './text_entry_blank_extension.ts';

export type RichTextExtension =
  & QFlowBasicExtension
  & TextEntryBlankExtension
  & InlineChoiceSlotExtension
  & GapMatchSlotExtension
  & HottextSlotExtension;

export type TextEntryBlankInput = {
  id: string;
  label: string;
  widthClass?: string;
};

export type RichTextEditorApi = {
  insertHtml: (html: string) => void;
  insertTextEntryBlank: (blank: TextEntryBlankInput) => void;
  focus: () => void;
};
