import type { TypeDriver } from '../registry.ts';
import type { SliderDraft } from '../slider.ts';
import { defaultsSlider, toQti3SliderAuthoringItem, validateSlider } from '../slider.ts';

export const sliderDriver: TypeDriver<SliderDraft> = {
  id: 'slider',
  label: 'Slider',
  defaults: () => defaultsSlider(),
  validate: (d) => validateSlider(d),
  toQti3AuthoringItem: (d, opts) => toQti3SliderAuthoringItem(d, opts),
};
