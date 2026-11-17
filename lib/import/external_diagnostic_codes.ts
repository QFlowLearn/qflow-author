import type { MigrationWarningCode } from './migration_warning_catalog.ts';

/**
 * Translate one external producer diagnostic through its exact allowlist.
 *
 * Unknown codes fail closed instead of inheriting policy from a similarly named internal code.
 */
export function migrationWarningCodeFromExternal(
  value: string,
  allowedCodes: Readonly<Record<string, MigrationWarningCode>>,
): MigrationWarningCode {
  return allowedCodes[value] ?? 'UNREGISTERED_IMPORT_DIAGNOSTIC';
}
