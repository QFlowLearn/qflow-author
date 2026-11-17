import { sha256Hex } from '../sha256.ts';
import type { ImportedPart, ImportedPlacement } from './types.ts';

/** Translate flat bank category directives into one group per exact source path. */
export async function categoryParts(
  entries: readonly { readonly category: string | null; readonly placement: ImportedPlacement }[],
): Promise<ImportedPart[]> {
  const groups = new Map<string | null, ImportedPlacement[]>();
  for (const entry of entries) {
    const placements = groups.get(entry.category);
    if (placements) placements.push(entry.placement);
    else groups.set(entry.category, [entry.placement]);
  }
  const parts: ImportedPart[] = [];
  for (const [category, placements] of groups) {
    parts.push({
      // Hash the full path, not its leaf label or its position in the file.
      id: category === null
        ? 'uncategorized'
        : `category-${await sha256Hex(new TextEncoder().encode(category))}`,
      title: category === null ? 'Uncategorized' : category,
      placements,
    });
  }
  return parts;
}
