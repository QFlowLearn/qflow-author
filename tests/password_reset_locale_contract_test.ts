import { expect, test as testCase } from 'vitest';

import * as _fs from 'node:fs/promises';

import { getTableColumns } from 'drizzle-orm';
import { passwordResetEmailDeliveries } from '../lib/db/auth_schema.ts';

testCase('password-reset delivery locale migration is strict and transactional', async () => {
  const migration = await _fs.readFile(
    'db/migrations/0047_password_reset_delivery_locale.sql',
    'utf8',
  );
  expect(migration).toContain('ADD COLUMN interface_locale text');
  expect(migration).toContain('FROM user_settings s');
  expect(migration).toContain('ALTER COLUMN interface_locale SET NOT NULL');
  expect(migration).toContain("'en-US','en-GB','es-ES','es-419'");
  if (migration.includes("DEFAULT 'en-US'")) {
    expect.unreachable('Expected !migration.includes("DEFAULT \'en-US\'")');
  }
  // Locale capture and frozen delivery are exercised by password_reset_service_test.ts.
  // OIDC locale cookies and failure translation are exercised by oidc_callback_test.ts
  // and auth_boundary_test.ts through their public HTTP handlers.
  const columns = getTableColumns(passwordResetEmailDeliveries);
  expect(columns.interfaceLocale.name).toStrictEqual('interface_locale');
  expect(columns.interfaceLocale.notNull).toStrictEqual(true);
  expect(columns.interfaceLocale.hasDefault).toStrictEqual(false);
});
