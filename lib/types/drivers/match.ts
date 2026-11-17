import type { TypeDriver } from '../registry.ts';
import type { MatchDraft } from '../match.ts';
import { defaultsMatch, toQti3MatchAuthoringItem, validateMatch } from '../match.ts';

export const matchDriver: TypeDriver<MatchDraft> = {
  id: 'match',
  label: 'Matching',
  defaults: () => defaultsMatch(),
  validate: (d) => validateMatch(d),
  toQti3AuthoringItem: (d, opts) => toQti3MatchAuthoringItem(d, opts),
  capabilities: { shuffle: true },
};
