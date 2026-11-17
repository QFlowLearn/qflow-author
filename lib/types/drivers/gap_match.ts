import type { TypeDriver } from '../registry.ts';
import type { GapMatchDraft } from '../gap_match.ts';
import { defaultsGapMatch, toQti3GapMatchAuthoringItem, validateGapMatch } from '../gap_match.ts';

export const gapMatchDriver: TypeDriver<GapMatchDraft> = {
  id: 'gap_match',
  label: 'Gap Match',
  defaults: () => defaultsGapMatch(),
  validate: (d) => validateGapMatch(d),
  toQti3AuthoringItem: (d, opts) => toQti3GapMatchAuthoringItem(d, opts),
  capabilities: { shuffle: true },
};
