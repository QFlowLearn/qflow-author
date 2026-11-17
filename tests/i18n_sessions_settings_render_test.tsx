import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import SessionsPage from '../lib/http/routes/settings_pages/sessions.tsx';
import type { TenantSessionRecord } from '../lib/services/auth_sessions.ts';

const errors = {
  not_found: 'settings.sessions.notFound',
  missing_session: 'settings.sessions.missingSessionId',
  missing_user: 'settings.sessions.missingUserId',
  none_for_user: 'settings.sessions.noneForUser',
  unknown_action: 'settings.sessions.unknownAction',
} as const;
const success = {
  revoked: 'settings.sessions.revoked',
  all_revoked: 'settings.sessions.allRevoked',
} as const;
const session: TenantSessionRecord = {
  id: 'session-1',
  userId: 'u',
  email: 'person@example.test',
  displayName: 'Person',
  userAgent: 'Browser/1.0',
  ipAddress: '203.0.113.5',
  createdAt: '2026-01-02T03:04:00.000Z',
  lastSeenAt: '2026-01-02T03:04:00.000Z',
  expiresAt: '2026-01-03T03:04:00.000Z',
};
for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
  testCase(`sessions alerts render in ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const empty = render(<SessionsPage i18n={i18n} data={{ sessions: [], selfUserId: 'u' }} />);
    expect(empty).toContain(i18n.t('settings.sessions.empty'));
    for (const [code, id] of Object.entries(errors)) {
      const html = render(
        <SessionsPage
          i18n={i18n}
          data={{ sessions: [], selfUserId: 'u', error: code as keyof typeof errors }}
        />,
      );
      expect(html).toContain(i18n.t(id));
      if (html.includes('settings.sessions.')) {
        expect.unreachable("Expected !html.includes('settings.sessions.')");
      }
    }
    for (const [code, id] of Object.entries(success)) {
      const html = render(
        <SessionsPage
          i18n={i18n}
          data={{ sessions: [], selfUserId: 'u', success: code as keyof typeof success }}
        />,
      );
      expect(html).toContain(i18n.t(id));
      if (html.includes('settings.sessions.')) {
        expect.unreachable("Expected !html.includes('settings.sessions.')");
      }
    }
  });
}

testCase('session success copy differs between English and Spanish', () => {
  const en = createI18n('en-US', catalogForLocale('en-US'));
  const es = createI18n('es-ES', catalogForLocale('es-ES'));
  const renderSuccess = (i18n: typeof en) =>
    render(
      <SessionsPage i18n={i18n} data={{ sessions: [], selfUserId: 'u', success: 'revoked' }} />,
    );
  if (!(renderSuccess(en) !== renderSuccess(es))) {
    expect.unreachable('Expected renderSuccess(en) !== renderSuccess(es)');
  }
});

testCase('populated session table differs between English and Spanish', () => {
  const make = (locale: 'en-US' | 'es-ES') => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    return render(<SessionsPage i18n={i18n} data={{ sessions: [session], selfUserId: 'u' }} />);
  };
  if (!(make('en-US') !== make('es-ES'))) {
    expect.unreachable("Expected make('en-US') !== make('es-ES')");
  }
});

for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419'] as const) {
  testCase(`populated sessions table renders in ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const other = {
      ...session,
      id: 'session-2',
      userId: 'other',
      displayName: null,
      userAgent: null,
      ipAddress: null,
      lastSeenAt: 'invalid',
    };
    const html = render(
      <SessionsPage i18n={i18n} data={{ sessions: [session, other], selfUserId: 'u' }} />,
    );
    for (
      const id of [
        'deviceTitle',
        'user',
        'device',
        'ip',
        'lastSeen',
        'expires',
        'actions',
        'currentUser',
        'unknownDevice',
        'revoke',
        'revokeAll',
        'unavailable',
      ]
    ) expect(html).toContain(i18n.t(`settings.sessions.${id}`));
    expect(html).toContain(i18n.formatDate(new Date(session.lastSeenAt), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }));
    expect(html).toContain(i18n.formatDate(new Date(session.expiresAt), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }));
    for (const value of ['Person', 'person@example.test', 'Browser/1.0', '203.0.113.5']) {
      expect(html).toContain(value);
    }
    if (html.includes('settings.sessions.')) {
      expect.unreachable("Expected !html.includes('settings.sessions.')");
    }
    if (
      !((html.match(new RegExp(i18n.t('settings.sessions.unavailable'), 'g')) ?? []).length >= 2)
    ) {
      expect.unreachable(
        "Expected (html.match(new RegExp(i18n.t('settings.sessions.unavailable'), 'g')) ?? []).length >= 2",
      );
    }
  });
}
