import type { TypeDriver } from '../registry.ts';
import type { HotspotDraft } from '../hotspot.ts';
import { defaultsHotspot, toQti3HotspotAuthoringItem, validateHotspot } from '../hotspot.ts';

export const hotspotDriver: TypeDriver<HotspotDraft> = {
  id: 'hotspot',
  label: 'Hotspot',
  defaults: () => defaultsHotspot(),
  validate: (d) => validateHotspot(d),
  toQti3AuthoringItem: (d, opts) =>
    toQti3HotspotAuthoringItem(d, { identifier: opts.identifier, lang: opts.lang }),
  capabilities: { minMaxChoices: true },
};
