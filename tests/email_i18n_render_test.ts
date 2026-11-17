import { expect, test as testCase } from 'vitest';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { buildPasswordResetEmail, buildSignupWelcomeEmail } from '../lib/services/email.ts';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const;
for (const interfaceLocale of locales) {
  testCase(`email builders render complete ${interfaceLocale} catalog copy`, () => {
    const catalog = catalogForLocale(interfaceLocale);
    const i18n = createI18n(interfaceLocale, { email: catalog.email });
    const welcome = buildSignupWelcomeEmail({
      email: 'user@example.test',
      displayName: '<Hostile>',
      userId: 'user',
      tenantId: 'tenant',
      source: 'password_web',
      interfaceLocale,
      from: 'from@example.test',
      bcc: 'bcc@example.test',
    });
    expect(welcome.subject).toStrictEqual(i18n.t('email.welcome.subject'));
    for (
      const id of [
        'email.welcome.ready',
        'email.welcome.platform',
        'email.welcome.beta',
        'email.welcome.feedback',
        'email.welcome.signoff',
      ] as const
    ) {
      expect(welcome.text ?? '').toContain(
        i18n.t(id, id === 'email.welcome.signoff' ? undefined : undefined),
      );
      const expected = id === 'email.welcome.signoff'
        ? i18n.t(id).replaceAll('\n', '<br>')
        : i18n.t(id);
      expect(welcome.html ?? '').toContain(expected);
    }
    expect(welcome.text ?? '').toContain(
      i18n.t('email.welcome.greeting', { displayName: '<Hostile>' }),
    );
    expect(welcome.html ?? '').toContain('&lt;Hostile&gt;');
    expect(welcome.html ?? '').not.toMatch(/<Hostile>/);
    const noName = buildSignupWelcomeEmail({
      email: 'user@example.test',
      displayName: null,
      userId: 'user',
      tenantId: 'tenant',
      source: 'password_web',
      interfaceLocale,
      from: 'from@example.test',
      bcc: 'bcc@example.test',
    });
    expect(noName.text ?? '').toContain(i18n.t('email.welcome.greetingNoName'));
    expect(noName.html ?? '').toContain(i18n.t('email.welcome.greetingNoName'));
    expect(welcome.html ?? '').toContain(
      `<!doctype html><html lang="${interfaceLocale}"><head><meta charset="utf-8"></head><body>`,
    );
    expect(welcome.html ?? '').toContain('</body></html>');
    expect(`${welcome.text}\n${welcome.html}`).not.toMatch(/email\.[a-z.]+/);

    const reset = buildPasswordResetEmail({
      email: 'user@example.test',
      resetUrl: 'https://example.test/reset?x="<secret>"',
      userId: 'user',
      tenantId: 'tenant',
      interfaceLocale,
    }, 'from@example.test');
    expect(reset.subject).toStrictEqual(i18n.t('email.reset.subject'));
    for (
      const id of [
        'email.reset.requested',
        'email.reset.linkInstruction',
        'email.reset.expiry',
        'email.reset.ignore',
      ] as const
    ) {
      expect(reset.text ?? '').toContain(i18n.t(id));
      if (id !== 'email.reset.linkInstruction') {
        expect(reset.html ?? '').toContain(i18n.t(id));
      }
    }
    expect(reset.text ?? '').toContain('https://example.test/reset?x="<secret>"');
    expect(reset.html ?? '').toContain(
      `href="https://example.test/reset?x=&quot;&lt;secret&gt;&quot;"`,
    );
    expect(reset.html ?? '').toContain(i18n.t('email.reset.linkText'));
    expect(reset.html ?? '').toContain(
      `<!doctype html><html lang="${interfaceLocale}"><head><meta charset="utf-8"></head><body>`,
    );
    expect(reset.html ?? '').toContain('</body></html>');
    expect(reset.html ?? '').not.toMatch(/email\.[a-z.]+/);
    if (interfaceLocale.startsWith('es')) {
      expect(`${welcome.text}\n${reset.text}`).not.toMatch(
        /Welcome|password reset was requested|Set a new password/,
      );
    }
  });
}

testCase('English regional welcome copy uses distinct wording', () => {
  const base = {
    email: 'a@b.test',
    displayName: null,
    userId: 'u',
    tenantId: 't',
    source: 'password_web' as const,
    from: 'x',
    bcc: 'y',
  };
  const us = buildSignupWelcomeEmail({ ...base, interfaceLocale: 'en-US' });
  const gb = buildSignupWelcomeEmail({ ...base, interfaceLocale: 'en-GB' });
  expect(us.text ?? '').toContain('run into');
  expect(gb.text ?? '').toContain('encounter');
  if (!(us.text !== gb.text)) expect.unreachable('Expected us.text !== gb.text');
});
