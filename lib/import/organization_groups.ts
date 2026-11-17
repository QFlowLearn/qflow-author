import { type ImportedPart, importedQuestionPlacements } from './types.ts';

/** Source organization is independent of assessment delivery parts. */
export type ImportedOrganizationGroup = {
  readonly id: string;
  readonly title: string;
  readonly hrefs: readonly string[];
};

/** Flat-format adapters explicitly project their source groups at the import boundary. */
export function organizationGroupsFromParts(
  parts: readonly ImportedPart[],
): ImportedOrganizationGroup[] {
  return parts.filter((p) => importedQuestionPlacements(p.placements).length > 0).map((p) => ({
    id: p.id,
    title: p.title,
    hrefs: [...new Set(importedQuestionPlacements(p.placements).map((r) => r.href))],
  }));
}

/** Parse the canonical stored catalog before it reaches organization or commit logic. */
export function parseImportedOrganizationGroups(value: unknown): ImportedOrganizationGroup[] {
  if (!Array.isArray(value)) throw new Error('Import organization groups must be an array.');
  const ids = new Set<string>();
  return value.map((entry) => {
    if (
      !record(entry) || Object.keys(entry).sort().join(',') !== 'hrefs,id,title' ||
      typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 256 ||
      ids.has(entry.id) ||
      typeof entry.title !== 'string' || !entry.title.trim() || !Array.isArray(entry.hrefs) ||
      !entry.hrefs.every((href): href is string => typeof href === 'string' && !!href.trim())
    ) {
      throw new Error('Invalid import organization group.');
    }
    ids.add(entry.id);
    return { id: entry.id, title: entry.title, hrefs: [...new Set(entry.hrefs)] };
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
