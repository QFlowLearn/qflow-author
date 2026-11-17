import type { TypeDriver } from '../registry.ts';
import type { GraphicAssociateDraft } from '../graphic_associate.ts';
import {
  defaultsGraphicAssociate,
  toQti3GraphicAssociateAuthoringItem,
  validateGraphicAssociate,
} from '../graphic_associate.ts';

export const graphicAssociateDriver: TypeDriver<GraphicAssociateDraft> = {
  id: 'graphic_associate',
  label: 'Graphic Associate',
  defaults: () => defaultsGraphicAssociate(),
  validate: (d) => validateGraphicAssociate(d),
  toQti3AuthoringItem: (d, opts) => toQti3GraphicAssociateAuthoringItem(d, opts),
};
