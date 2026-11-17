import type { TypeDriver } from '../registry.ts';
import type { SingleSelectDraft } from '../single_select.ts';
import {
  defaultsSingleSelect,
  toSingleSelectQti3AuthoringItem,
  validateSingleSelect,
} from '../single_select.ts';

export const singleSelectDriver: TypeDriver<SingleSelectDraft> = {
  id: 'single_select',
  label: 'Single Select',
  defaults: () => defaultsSingleSelect(),
  validate: (d) => validateSingleSelect(d),
  toQti3AuthoringItem: (d, opts) => toSingleSelectQti3AuthoringItem(d, opts),
  scoringTemplates: [
    {
      id: 'all_or_nothing',
      label: 'All or nothing',
      description: 'Default scoring for single-select. (match_correct)',
    },
    {
      id: 'partial',
      label: 'Partial credit',
      description: 'Maps each choice to a score entry. (map_response)',
    },
    {
      id: 'custom',
      label: 'Custom',
      description: 'Reserved for custom scoring. (coming soon)',
      disabled: true,
    },
  ],
  capabilities: { points: true, shuffle: true, required: true, answerMasking: true },
};
