import type { TypeDriver } from '../registry.ts';
import type { HottextDraft } from '../hottext.ts';
import { defaultsHottext, toQti3HottextAuthoringItem, validateHottext } from '../hottext.ts';

export const hottextDriver: TypeDriver<HottextDraft> = {
  id: 'hottext',
  label: 'Hot Text',
  defaults: () => defaultsHottext(),
  validate: (d) => validateHottext(d),
  toQti3AuthoringItem: (d, opts) =>
    toQti3HottextAuthoringItem(d, { identifier: opts.identifier, lang: opts.lang }),
  capabilities: { minMaxChoices: true },
};
