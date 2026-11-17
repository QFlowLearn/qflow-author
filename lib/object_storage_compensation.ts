import { mapConcurrentBounded } from './bounded_concurrency.ts';
import type { ObjectDeleter } from './storage_contract.ts';

const OBJECT_CLEANUP_CONCURRENCY = 4;

/** One object that could not be removed during compensating cleanup. */
export type ObjectCleanupFailure = {
  readonly objectKey: string;
  readonly cause: unknown;
};

/** Delete every staged object with bounded concurrency and retain all cleanup failures. */
export async function cleanupObjectKeys(
  storage: ObjectDeleter,
  objectKeys: readonly string[],
): Promise<ReadonlyArray<ObjectCleanupFailure>> {
  const uniqueKeys = [...new Set(objectKeys)];
  const outcomes = await mapConcurrentBounded(
    uniqueKeys,
    { concurrency: OBJECT_CLEANUP_CONCURRENCY },
    async (objectKey): Promise<ObjectCleanupFailure | null> => {
      try {
        await storage.deleteObject(objectKey);
        return null;
      } catch (cause: unknown) {
        return { objectKey, cause };
      }
    },
  );
  return outcomes.flatMap((outcome) => outcome === null ? [] : [outcome]);
}
