import type { ComponentChild } from 'preact';
import type { Draft } from '../../lib/types/draft.ts';
import {
  type DriverDraft,
  hydrateDriverDraft,
  type QuestionTypeId,
  serializeDriverDraft,
} from '../../lib/types/registry.ts';
import type { DriverEditorShell } from './types.ts';
import type { RightRailControls } from './right_rail/types.ts';

/** Browser-only context supplied to a question editor view. */
export type DriverUiContext<K extends QuestionTypeId> = {
  readonly draft: DriverDraft<K>;
  readonly update: (draft: DriverDraft<K>) => void;
  readonly editor: DriverEditorShell<DriverDraft<K>>;
};

/** Browser-only context supplied to a question settings-rail view. */
export type DriverRightRailContext = {
  readonly controls: RightRailControls;
};

/** Editor and settings views registered for one question type. */
export type DriverViewBundle<K extends QuestionTypeId> = {
  readonly ui: (ctx: DriverUiContext<K>) => ComponentChild;
  readonly rightRail: (ctx: DriverRightRailContext) => ComponentChild;
};

type RegisteredDriverViewBundle = {
  readonly ui: (ctx: {
    readonly draft: Draft;
    readonly update: (draft: Draft) => void;
    readonly editor: DriverEditorShell;
  }) => ComponentChild;
  readonly rightRail: (ctx: DriverRightRailContext) => ComponentChild;
};

const DRIVER_VIEWS = new Map<QuestionTypeId, RegisteredDriverViewBundle>();

/** Register one complete browser-only view bundle for a question type. */
export function registerDriverViewBundle<K extends QuestionTypeId>(
  typeId: K,
  views: DriverViewBundle<K>,
): void {
  DRIVER_VIEWS.set(typeId, {
    ui: ({ draft, update, editor }) =>
      views.ui({
        draft: hydrateDriverDraft(typeId, draft),
        update: (next) => update(serializeDriverDraft(typeId, next)),
        // SAFETY: the base editor accepts every Draft field; this view receives a strict subset.
        editor: editor as DriverEditorShell<DriverDraft<K>>,
      }),
    rightRail: views.rightRail,
  });
}

/** Return the registered browser-only views for one question type. */
export function driverViewsFor(typeId: QuestionTypeId): RegisteredDriverViewBundle | undefined {
  return DRIVER_VIEWS.get(typeId);
}
