import type { TypeDriver } from '../registry.ts';
import type { PositionObjectDraft } from '../position_object.ts';
import {
  defaultsPositionObject,
  toQti3PositionObjectAuthoringItem,
  validatePositionObject,
} from '../position_object.ts';

export const positionObjectDriver: TypeDriver<PositionObjectDraft> = {
  id: 'position_object',
  label: 'Position Object',
  defaults: () => defaultsPositionObject(),
  validate: (d) => validatePositionObject(d),
  toQti3AuthoringItem: (d, opts) => toQti3PositionObjectAuthoringItem(d, opts),
  capabilities: { minMaxChoices: true },
};
