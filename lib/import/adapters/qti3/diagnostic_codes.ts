import type { MigrationWarningCode } from '../../migration_warning_catalog.ts';

/** Exact migration warning codes accepted from qti3-core package parsing. */
export const QTI3_CORE_DIAGNOSTIC_CODES = {
  'package.item.reference.duplicate': 'QTI_PACKAGE_ITEM_REFERENCE_DUPLICATE',
} as const satisfies Readonly<Record<string, MigrationWarningCode>>;
