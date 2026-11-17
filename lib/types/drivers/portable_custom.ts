import type { TypeDriver } from '../registry.ts';
import type { PortableCustomDraft } from '../portable_custom.ts';
import {
  defaultsPortableCustom,
  toQti3PortableCustomAuthoringItem,
  validatePortableCustom,
} from '../portable_custom.ts';

export const portableCustomDriver: TypeDriver<PortableCustomDraft> = {
  id: 'portable_custom',
  label: 'Portable Custom Interaction',
  defaults: () => defaultsPortableCustom(),
  validate: (d) => validatePortableCustom(d),
  toQti3AuthoringItem: (d, opts) => toQti3PortableCustomAuthoringItem(d, opts),
};
