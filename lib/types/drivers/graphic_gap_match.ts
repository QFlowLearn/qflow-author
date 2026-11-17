import type { TypeDriver } from '../registry.ts';
import type { GraphicGapMatchDraft } from '../graphic_gap_match.ts';
import {
  defaultsGraphicGapMatch,
  toQti3GraphicGapMatchAuthoringItem,
  validateGraphicGapMatch,
} from '../graphic_gap_match.ts';

export const graphicGapMatchDriver: TypeDriver<GraphicGapMatchDraft> = {
  id: 'graphic_gap_match',
  label: 'Graphic Gap Match',
  defaults: () => defaultsGraphicGapMatch(),
  validate: (d) => validateGraphicGapMatch(d),
  toQti3AuthoringItem: (d, opts) =>
    toQti3GraphicGapMatchAuthoringItem(d, {
      identifier: opts.identifier,
      lang: opts.lang,
      scoring: opts.scoring === 'map_response' ? 'map_response' : 'match_correct',
    }),
  capabilities: { shuffle: true },
};
