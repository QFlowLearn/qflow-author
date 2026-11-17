import type { QtiMigrationResult } from '@longsightgroup/qti3-migrator';
import type { ImportedOrganizationGroup } from '../organization_groups.ts';
import type { ImportWarning } from '../types.ts';

/** Retain source group membership while explicitly disclosing the fixed-question downgrade. */
export function importQti12SourceGroups(result: QtiMigrationResult): {
  readonly groups: ImportedOrganizationGroup[];
  readonly warnings: ImportWarning[];
} {
  const groups: ImportedOrganizationGroup[] = [];
  const warnings: ImportWarning[] = [];
  for (const item of result.items) {
    for (const [index, group] of (item.qti12SourceGroups ?? []).entries()) {
      const members = new Set(group.itemIdentifiers);
      const hrefs = result.items.filter((candidate) =>
        candidate.standaloneHtml === undefined && members.has(candidate.identifier)
      ).map(
        (candidate) => candidate.href,
      );
      if (hrefs.length) {
        groups.push({ id: `${item.href}#group-${index + 1}`, title: group.title, hrefs });
      }
      warnings.push({
        code: 'CANVAS_GROUP_SELECTION_REVIEW',
        message: `Source group "${group.title}" (${group.identifier}): select ${
          group.selectionNumber || 'an unspecified number of'
        } questions; group points per question: ${group.pointsPerItem || 'unspecified'}${
          group.sourceBankRef ? `; linked bank: ${group.sourceBankRef}` : ''
        }. Imported ${hrefs.length} available questions as fixed questions with their own item points. Random selection, linked-bank draws and group point overrides are not applied. Set the intended points before delivery; use the original Canvas quiz when random draws are required.`,
      });
    }
  }
  return { groups, warnings };
}
