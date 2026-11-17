import * as _fs from 'node:fs/promises';
import { INTERFACE_LOCALES } from '../lib/i18n/locale.ts';
import { findDuplicateJsonKeys, validateCatalogData } from './check_i18n_validator.ts';

export async function main(): Promise<void> {
  /** Load untrusted JSON; the validator owns shape checks. */
  async function readJson(url: URL, label: string, diagnostics: string[]): Promise<unknown> {
    const source = await _fs.readFile(url, 'utf8');
    try {
      for (const property of findDuplicateJsonKeys(source)) {
        diagnostics.push(`${label}: duplicate JSON property ${property}`);
      }
    } catch (error) {
      diagnostics.push(
        `${label}: malformed JSON (${error instanceof Error ? error.message : 'invalid syntax'})`,
      );
    }
    try {
      return JSON.parse(source) as unknown;
    } catch (error) {
      diagnostics.push(
        `${label}: malformed JSON (${error instanceof Error ? error.message : 'invalid syntax'})`,
      );
      return null;
    }
  }

  const root = new URL('../lib/i18n/', import.meta.url);
  const sourceDiagnostics: string[] = [];
  const context = await readJson(
    new URL('message_context.json', root),
    'message_context.json',
    sourceDiagnostics,
  );
  const catalogs: Record<string, unknown> = {};
  for (const locale of INTERFACE_LOCALES) {
    const namespaces: Record<string, unknown> = {};
    const dir = new URL(`messages/${locale}/`, root);
    const files: string[] = [];
    for await (const file of await _fs.opendir(dir)) {
      if (file.name.endsWith('.json')) files.push(file.name);
    }
    for (const file of files.sort()) {
      namespaces[file.slice(0, -5)] = await readJson(
        new URL(file, dir),
        `${locale}/${file}`,
        sourceDiagnostics,
      );
    }
    catalogs[locale] = namespaces;
  }
  const diagnostics = [...sourceDiagnostics, ...validateCatalogData(context, catalogs)];
  if (diagnostics.length) {
    console.error(diagnostics.map((item) => `i18n: ${item}`).join('\n'));
    process.exit(1);
  }
  console.log(`i18n catalogs valid: ${INTERFACE_LOCALES.length} locales`);
}
if (import.meta.main) await main();
