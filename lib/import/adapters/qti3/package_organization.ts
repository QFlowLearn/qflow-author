import type {
  QtiAssessmentSectionPackageModel,
  QtiAssessmentTestPackageModel,
} from '@longsightgroup/qti3-core';
import { sha256Hex } from '../../../sha256.ts';
import type { ImportedOrganizationGroup } from '../../organization_groups.ts';

/** Assign direct references to their deepest named ancestor without changing delivery structure. */
export async function parseTestOrganization(
  test: QtiAssessmentTestPackageModel,
): Promise<ImportedOrganizationGroup[]> {
  const groups = new Map<string, { title: string; hrefs: Set<string> }>();
  function visit(
    section: QtiAssessmentSectionPackageModel,
    ids: readonly string[],
    titles: readonly string[],
    owner: string | null,
  ) {
    const path = [...ids, section.identifier];
    const title = section.title?.trim();
    const labels = title ? [...titles, title] : titles;
    const key = title ? JSON.stringify([test.href, ...path]) : owner;
    if (title && key !== null) {
      if (groups.has(key)) throw new Error('QTI source section identity is repeated.');
      groups.set(key, { title: labels.join(' / '), hrefs: new Set() });
    }
    if (key !== null) {
      const group = groups.get(key);
      if (!group) throw new Error('QTI source section owner is missing.');
      for (const ref of section.itemRefs) group.hrefs.add(ref.href);
    }
    for (const child of section.sections) visit(child, path, labels, key);
  }
  for (const part of test.testParts) {
    for (const section of part.sections) visit(section, [part.identifier], [], null);
  }
  const result: ImportedOrganizationGroup[] = [];
  for (const [key, group] of groups) {
    if (!group.hrefs.size) continue;
    result.push({
      id: `section-${await sha256Hex(new TextEncoder().encode(key))}`,
      title: group.title,
      hrefs: [...group.hrefs],
    });
  }
  return result;
}
