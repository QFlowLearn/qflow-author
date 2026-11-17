import type { TypeDriver } from '../registry.ts';
import type { OrderDraft } from '../order.ts';
import { defaultsOrder, toQti3OrderAuthoringItem, validateOrder } from '../order.ts';

export const orderDriver: TypeDriver<OrderDraft> = {
  id: 'order',
  label: 'Ordering',
  defaults: () => defaultsOrder(),
  validate: (d) => validateOrder(d),
  toQti3AuthoringItem: (d, opts) => toQti3OrderAuthoringItem(d, opts),
  capabilities: { shuffle: true, minMaxChoices: true },
};
