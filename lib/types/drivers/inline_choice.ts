import type { TypeDriver } from '../registry.ts';
import type { InlineChoiceDraft } from '../inline_choice.ts';
import {
  defaultsInlineChoice,
  toQti3InlineChoiceAuthoringItem,
  validateInlineChoice,
} from '../inline_choice.ts';

export const inlineChoiceDriver: TypeDriver<InlineChoiceDraft> = {
  id: 'inline_choice',
  label: 'Inline Choice',
  capabilities: { points: true },
  defaults: () => defaultsInlineChoice(),
  validate: (d) => validateInlineChoice(d),
  toQti3AuthoringItem: (d, opts) =>
    toQti3InlineChoiceAuthoringItem(d, { identifier: opts.identifier, lang: opts.lang }),
  scoringTemplates: [
    {
      id: 'all_or_nothing',
      label: 'All or nothing',
      description: 'Default scoring for inline choice. (match_correct)',
    },
    {
      id: 'partial',
      label: 'Partial credit',
      description: 'Maps each blank to a score entry. (map_response)',
    },
    {
      id: 'custom',
      label: 'Custom',
      description: 'Reserved for custom scoring. (coming soon)',
      disabled: true,
    },
  ],
};
