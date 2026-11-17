import { type ComponentChild, h } from 'preact';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import { DriverRightRail } from './right_rail/driver.tsx';
import { type DriverUiContext, registerDriverViewBundle } from './view_registry.ts';

/** Register one editor with the shared question settings rail. */
export function attachStandardDriverViews<K extends QuestionTypeId>(
  typeId: K,
  Editor: (ctx: DriverUiContext<K>) => ComponentChild,
): void {
  registerDriverViewBundle(typeId, {
    ui: Editor,
    rightRail: ({ controls }) => h(DriverRightRail, { controls }),
  });
}
