import { expect, test as testCase } from 'vitest';

import { parsePublicationGrantForm } from '../lib/services/publication_grants.ts';
import { SYSTEM_USER_ID } from '../lib/tenants.ts';

testCase('grant form accepts one exact action and a real member reference', () => {
  const userId = crypto.randomUUID();
  const form = new FormData();
  form.set('userId', userId);
  form.set('action', 'grant');
  expect(parsePublicationGrantForm(form)).toStrictEqual({ ok: true, userId, action: 'grant' });
  form.set('action', 'revoke');
  expect(parsePublicationGrantForm(form)).toStrictEqual({ ok: true, userId, action: 'revoke' });
  form.append('action', 'grant');
  expect(parsePublicationGrantForm(form)).toStrictEqual({ ok: false, code: 'invalid_input' });
  form.set('action', 'grant');
  form.set('unexpected', 'ignored');
  expect(parsePublicationGrantForm(form)).toStrictEqual({ ok: false, code: 'invalid_input' });
  form.delete('unexpected');
  for (const invalid of [SYSTEM_USER_ID, 'missing', new File(['id'], 'id.txt')]) {
    form.set('userId', invalid);
    expect(parsePublicationGrantForm(form)).toStrictEqual({ ok: false, code: 'invalid_member' });
  }
});
