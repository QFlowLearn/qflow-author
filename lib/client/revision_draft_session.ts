/** Serializes revision-draft autosaves and creates a publish barrier. */
export type RevisionDraftSessionQueue = {
  readonly enqueueAutosave: () => void;
  readonly beginPublish: () => Promise<void>;
  readonly finishPublish: (published: boolean) => void;
};

export type RevisionDraftSessionFailureCode = 'save_failed';

/**
 * Owns the ordering contract between autosave and publish.
 *
 * The supplied save operation reads the latest editor state when its turn begins. A publish waits
 * for all work already queued, and a failed publish immediately queues the latest state again.
 */
export function createRevisionDraftSessionQueue(
  saveLatest: () => Promise<void>,
  reportSaveError: (code: RevisionDraftSessionFailureCode) => void,
): RevisionDraftSessionQueue {
  let pending: Promise<void> | null = null;
  let publishing = false;

  function enqueueAutosave(): void {
    if (publishing) return;
    const previous = pending ?? Promise.resolve();
    const next = previous.then(async () => {
      try {
        await saveLatest();
      } catch (_cause: unknown) {
        if (!publishing) {
          reportSaveError('save_failed');
        }
      }
    }).finally(() => {
      if (pending === next) pending = null;
    });
    pending = next;
  }

  async function beginPublish(): Promise<void> {
    publishing = true;
    await pending;
  }

  function finishPublish(published: boolean): void {
    publishing = false;
    if (!published) enqueueAutosave();
  }

  return { enqueueAutosave, beginPublish, finishPublish };
}
