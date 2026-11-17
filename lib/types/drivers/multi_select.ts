import type { TypeDriver } from '../registry.ts';
import type { MultiSelectDraft } from '../multi_select.ts';
import {
  defaultsMultiSelect,
  toMultiSelectQti3AuthoringItem,
  validateMultiSelect,
} from '../multi_select.ts';

export const multiSelectDriver: TypeDriver<MultiSelectDraft> = {
  id: 'multi_select',
  label: 'Multi Select',
  defaults: () => defaultsMultiSelect(),
  validate: (d) => validateMultiSelect(d),
  toQti3AuthoringItem: (d, opts) => toMultiSelectQti3AuthoringItem(d, opts),
  scoringTemplates: [
    {
      id: 'all_or_nothing',
      label: 'All or nothing',
      description: 'Default scoring for multi-select. (match_correct)',
    },
    {
      id: 'partial',
      label: 'Partial credit',
      description: 'Maps each correct choice to a score entry. (map_response)',
    },
    {
      id: 'custom',
      label: 'Custom',
      description: 'Reserved for custom scoring. (coming soon)',
      disabled: true,
    },
  ],
  capabilities: { points: true, shuffle: true, minMaxChoices: true, answerMasking: true },
};
