import type { TypeDriver } from '../registry.ts';
import {
  defaultsExtendedText,
  type ExtendedTextDraft,
  toQti3ExtendedTextAuthoringItem,
  validateExtendedText,
} from '../extended_text.ts';

export const extendedTextDriver: TypeDriver<ExtendedTextDraft> = {
  id: 'extended_text',
  label: 'Extended Text',
  defaults: () => defaultsExtendedText(),
  validate: (draft) => validateExtendedText(draft),
  toQti3AuthoringItem: (draft, opts) => toQti3ExtendedTextAuthoringItem(draft, opts),
  capabilities: {},
};
