import type { TypeDriver } from '../registry.ts';
import type { MediaDraft } from '../media.ts';
import { defaultsMedia, toQti3MediaAuthoringItem, validateMedia } from '../media.ts';

export const mediaDriver: TypeDriver<MediaDraft> = {
  id: 'media',
  label: 'Media Interaction',
  defaults: () => defaultsMedia(),
  validate: (d) => validateMedia(d),
  toQti3AuthoringItem: (d, opts) => toQti3MediaAuthoringItem(d, opts),
};
