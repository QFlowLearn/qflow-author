import type { TypeDriver } from '../registry.ts';
import type { TextEntryDraft } from '../text_entry.ts';
import {
  defaultsTextEntry,
  toQti3TextEntryAuthoringItem,
  validateTextEntry,
} from '../text_entry.ts';

export const textEntryDriver: TypeDriver<TextEntryDraft> = {
  id: 'text_entry',
  label: 'Text Entry',
  defaults: () => defaultsTextEntry(),
  validate: (d) => validateTextEntry(d),
  toQti3AuthoringItem: (d, opts) => toQti3TextEntryAuthoringItem(d, opts),
  capabilities: {},
};
