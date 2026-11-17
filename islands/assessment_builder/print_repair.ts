import type { AuthoringState, ItemMeta, Part } from './types.ts';

/** Reuse the unified editor and its draft guard for placement- or section-specific paper repairs. */
export function createPrintRepairAction(options: {
  readonly assessmentId: string;
  readonly parts: readonly Part[];
  readonly items: Readonly<Record<string, ItemMeta>>;
  readonly guard: (action: () => void | Promise<unknown>) => Promise<void>;
  readonly openSettings: () => void;
  readonly setAuthoring: (state: AuthoringState) => void;
  readonly edit: (
    itemId: string,
    placementId: string,
    partId: string,
    revision: number,
  ) => Promise<unknown>;
}): (id: string) => Promise<void> {
  return (id) =>
    options.guard(async () => {
      if (id === options.assessmentId) {
        options.openSettings();
        return;
      }
      for (const part of options.parts) {
        if (part.id === id) {
          options.openSettings();
          return;
        }
        const placement = part.placements.find((placement) => placement.id === id);
        if (!placement) continue;
        if ('content' in placement) {
          options.setAuthoring({ _tag: 'EditingContent', partId: part.id, placement });
          return;
        }
        const meta = options.items[id];
        if (meta) {
          await options.edit(
            placement.itemId,
            id,
            part.id,
            placement.snapshotRev ?? meta.latestRev,
          );
        }
        return;
      }
    });
}
