import type { TypeDriver } from '../registry.ts';
import type { DrawingDraft } from '../drawing.ts';
import { defaultsDrawing, toQti3DrawingAuthoringItem, validateDrawing } from '../drawing.ts';

export const drawingDriver: TypeDriver<DrawingDraft> = {
  id: 'drawing',
  label: 'Drawing',
  defaults: () => defaultsDrawing(),
  validate: (d) => validateDrawing(d),
  toQti3AuthoringItem: (d, opts) => toQti3DrawingAuthoringItem(d, opts),
};
