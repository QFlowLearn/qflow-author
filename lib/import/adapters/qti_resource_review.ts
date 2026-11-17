import {
  discoverQtiPackageContentAssets,
  parseQtiXml,
  validateAssessmentItem,
} from '@longsightgroup/qti3-core';
import type { ImportResult, ImportWarning } from '../types.ts';

/** Validate review items independently of whether all items form a launchable package. */
export function validateQtiResourceReview(imported: ImportResult): ImportWarning[] {
  const assets = new Set(imported.assets.map((asset) => asset.path));
  const warnings: ImportWarning[] = [];
  for (const item of imported.items) {
    const parsed = parseQtiXml(item.xml);
    if (
      !parsed.ok || !parsed.document ||
      validateAssessmentItem(parsed.document).diagnostics.some((diagnostic) =>
        diagnostic.severity === 'error'
      )
    ) {
      throw new Error('Migrated question XML failed structural validation.');
    }
    const discovery = discoverQtiPackageContentAssets(item.xml, item.href);
    if (discovery.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      warnings.push({
        code: 'QTI_RESOURCE_ASSET_REVIEW',
        path: item.href,
        message:
          'A converted media URL is invalid. Correct the original reference and import again.',
      });
    }
    for (const href of discovery.hrefs) {
      if (!assets.has(href)) {
        warnings.push({
          code: 'QTI_RESOURCE_ASSET_REVIEW',
          path: item.href,
          message:
            `Required media ${href} is missing from the source resource. Restore the original file and import again.`,
        });
      }
    }
  }
  return warnings;
}
