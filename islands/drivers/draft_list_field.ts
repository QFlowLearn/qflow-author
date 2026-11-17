import type { Draft } from '../../lib/types/draft.ts';

/** Array-valued keys available on one exact draft shape. */
export type DraftListKeyFor<D extends object> = keyof {
  [K in keyof D as NonNullable<D[K]> extends readonly unknown[] ? K : never]: D[K];
};

/** Array value stored under one array-valued draft key. */
export type DraftListValueFor<
  D extends object,
  K extends DraftListKeyFor<D>,
> = NonNullable<D[K]>;

export type DraftListKey = DraftListKeyFor<Draft>;

export type DraftListValue<K extends DraftListKey> = DraftListValueFor<Draft, K>;

export type DraftListUpdater<K extends DraftListKey> =
  | DraftListValue<K>
  | ((prev: DraftListValue<K>) => DraftListValue<K>);

/** Array replacement or updater accepted for one exact draft list field. */
export type DraftListUpdaterFor<
  D extends object,
  K extends DraftListKeyFor<D>,
> =
  | DraftListValueFor<D, K>
  | ((prev: DraftListValueFor<D, K>) => DraftListValueFor<D, K>);

function draftListValue<D extends object, K extends DraftListKeyFor<D>>(
  draft: D,
  key: K,
): DraftListValueFor<D, K> {
  const value = draft[key];
  if (!Array.isArray(value)) {
    throw new Error(`Draft field ${String(key)} is not an array`);
  }
  // SAFETY: DraftListKeyFor only admits array-valued fields and the runtime check rejects drift.
  return value as DraftListValueFor<D, K>;
}

export function applyDraftListField<D extends object, K extends DraftListKeyFor<D>>(
  draft: D,
  key: K,
  value: DraftListUpdaterFor<D, K>,
): D {
  const prevValue = draftListValue(draft, key);
  const nextValue = typeof value === 'function'
    ? (value as (prev: DraftListValueFor<D, K>) => DraftListValueFor<D, K>)(prevValue)
    : value;
  return { ...draft, [key]: nextValue };
}
