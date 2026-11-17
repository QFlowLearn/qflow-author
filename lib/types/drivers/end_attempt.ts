import type { TypeDriver } from '../registry.ts';
import type { EndAttemptDraft } from '../end_attempt.ts';
import {
  defaultsEndAttempt,
  toQti3EndAttemptAuthoringItem,
  validateEndAttempt,
} from '../end_attempt.ts';

export const endAttemptDriver: TypeDriver<EndAttemptDraft> = {
  id: 'end_attempt',
  label: 'End Attempt',
  defaults: () => defaultsEndAttempt(),
  validate: (d) => validateEndAttempt(d),
  toQti3AuthoringItem: (d, opts) => toQti3EndAttemptAuthoringItem(d, opts),
};
