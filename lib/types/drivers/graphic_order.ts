import type { TypeDriver } from '../registry.ts';
import type { GraphicOrderDraft } from '../graphic_order.ts';
import {
  defaultsGraphicOrder,
  toQti3GraphicOrderAuthoringItem,
  validateGraphicOrder,
} from '../graphic_order.ts';

export const graphicOrderDriver: TypeDriver<GraphicOrderDraft> = {
  id: 'graphic_order',
  label: 'Graphic Order',
  defaults: () => defaultsGraphicOrder(),
  validate: (d) => validateGraphicOrder(d),
  toQti3AuthoringItem: (d, opts) => toQti3GraphicOrderAuthoringItem(d, opts),
  capabilities: { minMaxChoices: true },
};
