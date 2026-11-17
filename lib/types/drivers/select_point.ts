import type { TypeDriver } from '../registry.ts';
import type { SelectPointDraft } from '../select_point.ts';
import {
  defaultsSelectPoint,
  toQti3SelectPointAuthoringItem,
  validateSelectPoint,
} from '../select_point.ts';

export const selectPointDriver: TypeDriver<SelectPointDraft> = {
  id: 'select_point',
  label: 'Select Point',
  defaults: () => defaultsSelectPoint(),
  validate: (d) => validateSelectPoint(d),
  toQti3AuthoringItem: (d, opts) => toQti3SelectPointAuthoringItem(d, opts),
  capabilities: { minMaxChoices: true },
};
