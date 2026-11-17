import type { QuestionTypeId } from '../../lib/types/registry.ts';
import { driverViewsFor } from '../drivers/view_registry.ts';
import { type RetryableModuleState, useRetryableModule } from '../useRetryableModule.ts';

/** A dynamic import for one exact question-driver view module. */
export type DriverViewImport = () => Promise<unknown>;

/** Exhaustive question-type to view-module imports. */
export type DriverViewImports = Readonly<Record<QuestionTypeId, DriverViewImport>>;

/** Explicit failure to load or register one question driver's views. */
export class DriverViewsUnavailable extends Error {
  readonly _tag = 'DriverViewsUnavailable' as const;

  constructor(readonly typeId: QuestionTypeId, cause: unknown) {
    super(`Question editor controls are unavailable for ${typeId}.`, { cause });
  }
}

/** Exact dynamic import map for every supported question type. */
export const DRIVER_VIEW_IMPORTS: DriverViewImports = {
  single_select: () => import('../drivers/single_select.tsx'),
  multi_select: () => import('../drivers/multi_select.tsx'),
  text_entry: () => import('../drivers/text_entry.tsx'),
  order: () => import('../drivers/order.tsx'),
  match: () => import('../drivers/match.tsx'),
  associate: () => import('../drivers/associate.tsx'),
  inline_choice: () => import('../drivers/inline_choice.tsx'),
  extended_text: () => import('../drivers/extended_text.tsx'),
  gap_match: () => import('../drivers/gap_match.tsx'),
  graphic_gap_match: () => import('../drivers/graphic_gap_match.tsx'),
  graphic_associate: () => import('../drivers/graphic_associate.tsx'),
  graphic_order: () => import('../drivers/graphic_order.tsx'),
  media: () => import('../drivers/media.tsx'),
  portable_custom: () => import('../drivers/portable_custom.tsx'),
  position_object: () => import('../drivers/position_object.tsx'),
  select_point: () => import('../drivers/select_point.tsx'),
  slider: () => import('../drivers/slider.tsx'),
  upload: () => import('../drivers/upload.tsx'),
  hotspot: () => import('../drivers/hotspot.tsx'),
  hottext: () => import('../drivers/hottext.tsx'),
  custom_interaction: () => import('../drivers/custom_interaction.tsx'),
  drawing: () => import('../drivers/drawing.tsx'),
  end_attempt: () => import('../drivers/end_attempt.tsx'),
};

/** Build a deduplicating loader around an explicit import and registration seam. */
export function createDriverViewLoader(
  imports: DriverViewImports,
  isViewRegistered: (typeId: QuestionTypeId) => boolean,
): (typeId: QuestionTypeId) => Promise<void> {
  const requests = new Map<QuestionTypeId, Promise<void>>();

  return (typeId) => {
    const existing = requests.get(typeId);
    if (existing) return existing;

    const request = Promise.resolve()
      .then(imports[typeId])
      .then(() => {
        if (!isViewRegistered(typeId)) {
          throw new DriverViewsUnavailable(typeId, undefined);
        }
      })
      .catch((cause: unknown) => {
        requests.delete(typeId);
        if (cause instanceof DriverViewsUnavailable) throw cause;
        throw new DriverViewsUnavailable(typeId, cause);
      });
    requests.set(typeId, request);
    return request;
  };
}

/** Load and register the views for one exact question type. */
export const loadDriverViews = createDriverViewLoader(
  DRIVER_VIEW_IMPORTS,
  (typeId) => driverViewsFor(typeId) !== undefined,
);

/** Lifecycle of the active question driver's asynchronously loaded views. */
export type DriverViewsState = RetryableModuleState<QuestionTypeId, void>;

/** Load the exact active driver views and expose retry without losing editor state. */
export function useDriverViews(typeId: QuestionTypeId): {
  readonly state: DriverViewsState;
  readonly retry: () => void;
} {
  return useRetryableModule(typeId, loadDriverViews);
}
