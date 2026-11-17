/** Normalizes persisted or submitted item-bank tags into their canonical form. */
export function normalizeQuestionBankTags(
  values: readonly unknown[] | null | undefined,
): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(values.flatMap((value) => {
      if (typeof value !== 'string') return [];
      const tag = value.trim().toLowerCase();
      return tag ? [tag] : [];
    })),
  ].sort();
}
