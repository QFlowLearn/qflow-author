import type { Draft } from './draft.ts';
import type { QuestionTypeId } from './registry.ts';

/** Return a deterministic, minimally buildable draft for serializer verification. */
export function prepareDriverDraftForBuild(typeId: QuestionTypeId, draft: Draft): Draft {
  const next: Draft = { ...draft, type: typeId };

  switch (typeId) {
    case 'hotspot':
      if (!next.hotspotImageSrc?.trim()) {
        next.hotspotImageSrc = 'diagram.png';
      }
      if (!next.hotspotImageAlt?.trim()) {
        next.hotspotImageAlt = 'Diagram';
      }
      return next;
    case 'media':
      next.mediaSources = [{ src: 'media.mp4', type: 'video/mp4' }];
      return next;
    default:
      return next;
  }
}
