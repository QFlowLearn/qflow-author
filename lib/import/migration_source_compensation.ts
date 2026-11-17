import { inArray } from 'drizzle-orm';
import { db } from '../db.ts';
import { conversionSourceArtifacts } from '../db/schema.ts';
import { cleanupObjectKeys, type ObjectCleanupFailure } from '../object_storage_compensation.ts';
import type { ObjectWriteLifecycle } from '../storage_contract.ts';

/** Signals that staged source objects could not be proven safe to remove or fully deleted. */
export class MigrationSourceCleanupRequiredError extends Error {
  readonly _tag = 'MigrationSourceCleanupRequiredError' as const;

  constructor(
    readonly idempotencyKey: string,
    readonly objectKeys: readonly string[],
    readonly cleanupFailures: ReadonlyArray<ObjectCleanupFailure>,
    readonly operationCause: unknown,
    readonly ownershipCheckCause: unknown | null,
  ) {
    super('Migration source object cleanup requires operator attention.');
    this.name = 'MigrationSourceCleanupRequiredError';
  }
}

/** Remove every staged source object that has no committed artifact owner. */
export async function cleanupUnownedMigrationSourceObjects(input: {
  readonly storage: ObjectWriteLifecycle;
  readonly idempotencyKey: string;
  readonly objectKeys: readonly string[];
  readonly operationCause: unknown;
}): Promise<void> {
  if (input.objectKeys.length === 0) return;

  let ownedKeys: Set<string>;
  try {
    const rows = await db.select({ storageKey: conversionSourceArtifacts.storageKey })
      .from(conversionSourceArtifacts)
      .where(inArray(conversionSourceArtifacts.storageKey, input.objectKeys));
    ownedKeys = new Set(rows.map((row) => row.storageKey));
  } catch (ownershipCheckCause: unknown) {
    throw new MigrationSourceCleanupRequiredError(
      input.idempotencyKey,
      input.objectKeys,
      [],
      input.operationCause,
      ownershipCheckCause,
    );
  }

  const unownedKeys = input.objectKeys.filter((key) => !ownedKeys.has(key));
  const cleanupFailures = await cleanupObjectKeys(input.storage, unownedKeys);
  if (cleanupFailures.length === 0) return;
  throw new MigrationSourceCleanupRequiredError(
    input.idempotencyKey,
    unownedKeys,
    cleanupFailures,
    input.operationCause,
    null,
  );
}

/** Compensate unowned staged sources and then preserve the original operation failure. */
export async function throwAfterMigrationSourceCleanup(input: {
  readonly storage: ObjectWriteLifecycle;
  readonly idempotencyKey: string;
  readonly objectKeys: readonly string[];
  readonly cause: unknown;
}): Promise<never> {
  await cleanupUnownedMigrationSourceObjects({
    storage: input.storage,
    idempotencyKey: input.idempotencyKey,
    objectKeys: input.objectKeys,
    operationCause: input.cause,
  });
  throw input.cause;
}
