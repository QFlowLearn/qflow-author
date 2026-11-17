import type { TypeDriver } from '../registry.ts';
import type { AssociateDraft } from '../associate.ts';
import {
  defaultsAssociate,
  toQti3AssociateAuthoringItem,
  validateAssociate,
} from '../associate.ts';

export const associateDriver: TypeDriver<AssociateDraft> = {
  id: 'associate',
  label: 'Associate',
  defaults: () => defaultsAssociate(),
  validate: (d) => validateAssociate(d),
  toQti3AuthoringItem: (d, opts) => toQti3AssociateAuthoringItem(d, opts),
  capabilities: { shuffle: true },
};
