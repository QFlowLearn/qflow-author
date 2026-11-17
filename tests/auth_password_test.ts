import { expect, test as testCase } from 'vitest';

import { hashPassword, passwordIssues, verifyPassword } from '../lib/services/auth_crypto.ts';

testCase('password hashing round-trips with Web Crypto PBKDF2', async () => {
  const password = 'A unique password phrase for 2026';
  const hash = await hashPassword(password);

  expect(hash.startsWith('pbkdf2$100000$')).toStrictEqual(true);
  expect(await verifyPassword(password, hash)).toStrictEqual(true);
  expect(await verifyPassword('A different password phrase for 2026', hash)).toStrictEqual(false);
});

testCase('password policy uses explicit length bounds without arbitrary composition rules', () => {
  expect(passwordIssues('Password1')).toStrictEqual(['Password must be at least 12 characters.']);
  expect(passwordIssues('unique-pass!')).toStrictEqual([]);
  expect(passwordIssues('password1234')).toStrictEqual([]);
  expect(passwordIssues('a long uncommon phrase with spaces')).toStrictEqual([]);
  expect(passwordIssues('correcthorsebatterystaple')).toStrictEqual([]);
});
