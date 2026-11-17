import type { TypeDriver } from '../registry.ts';
import type { CustomInteractionDraft } from '../custom_interaction.ts';
import {
  defaultsCustomInteraction,
  toQti3CustomInteractionAuthoringItem,
  validateCustomInteraction,
} from '../custom_interaction.ts';

export const customInteractionDriver: TypeDriver<CustomInteractionDraft> = {
  id: 'custom_interaction',
  label: 'Custom Interaction',
  defaults: () => defaultsCustomInteraction(),
  validate: (d) => validateCustomInteraction(d),
  toQti3AuthoringItem: (d, opts) => toQti3CustomInteractionAuthoringItem(d, opts),
};
