import { expect, test as testCase } from 'vitest';

import { renderPage as render } from './helpers/render_page.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { AuditLogRecord } from '../lib/services/audit_logs.ts';
import type { MemberRecord } from '../lib/services/memberships.ts';
import AuditLogPage from '../lib/http/routes/settings_pages/audit.tsx';

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
const actionValues = [
  'login_success',
  'login_failed',
  'logout',
  'password_reset_requested',
  'password_reset_completed',
  'password_changed',
  'member_created',
  'member_role_updated',
  'member_removed',
  'session_revoked',
  'session_revoke_user',
  'migration_queued',
  'migration_batch_created',
  'migration_batch_reviewer_assigned',
  'migration_approval_submitted',
  'migration_approval_granted',
  'migration_changes_requested',
  'migration_retry_queued',
  'migration_analyzed',
  'migration_analysis_failed',
  'migration_item_reviewed',
  'migration_committed',
  'sso_config_updated',
] as const;

const members: MemberRecord[] = [
  {
    userId: 'user-a',
    email: 'alice@example.test',
    displayName: 'Alice Example',
    role: 'owner',
    canPublishEditions: false,
  },
  {
    userId: 'user-b',
    email: 'bob@example.test',
    displayName: 'Bob Example',
    role: 'admin',
    canPublishEditions: false,
  },
];

const knownLog: AuditLogRecord = {
  id: 'event-known',
  action: 'login_success',
  actorUserId: 'user-a',
  actorEmail: 'alice@example.test',
  actorName: 'Alice Example',
  targetUserId: 'user-b',
  targetEmail: 'bob@example.test',
  targetName: 'Bob Example',
  ipAddress: '203.0.113.42',
  userAgent: 'AuditTest/1.0',
  metadata: { source: 'integration-test', count: 2 },
  createdAt: '2026-01-02T03:04:00.000Z',
};

const unknownLog: AuditLogRecord = {
  id: 'event-future',
  action: 'future_action_code',
  actorUserId: null,
  actorEmail: null,
  actorName: null,
  targetUserId: null,
  targetEmail: null,
  targetName: null,
  ipAddress: null,
  userAgent: null,
  metadata: {},
  createdAt: 'not-a-timestamp',
};

for (const locale of locales) {
  testCase(`audit log renders localized framing and actions in ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = render(
      <AuditLogPage
        i18n={i18n}
        data={{ logs: [knownLog, unknownLog], members, action: null, userId: null }}
      />,
    );

    for (
      const id of [
        'title',
        'subtitle',
        'user',
        'allUsers',
        'action',
        'allActions',
        'apply',
        'clear',
        'recent',
        'date',
        'actor',
        'target',
        'ip',
        'details',
        'unavailable',
      ]
    ) expect(html).toContain(i18n.t(`settings.audit.${id}`));

    for (const action of actionValues) {
      expect(html).toContain(`value="${action}"`);
      expect(html).toContain(i18n.t(`settings.audit.action.${action}`));
    }
    expect(html).toContain(i18n.t('settings.audit.action.login_success'));
    expect(html).toContain(i18n.formatDate(new Date(knownLog.createdAt), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }));
    expect(html).toContain('Alice Example');
    expect(html).toContain('alice@example.test');
    expect(html).toContain('Bob Example');
    expect(html).toContain('bob@example.test');
    expect(html).toContain('203.0.113.42');
    // Preact escapes JSON quotes in text nodes; this still asserts the exact serialized payload.
    const renderedMetadata = JSON.stringify(knownLog.metadata).replaceAll('"', '&quot;');
    expect(html).toContain(renderedMetadata);
    expect(html).toContain('future_action_code');
    if (!((html.match(new RegExp(i18n.t('settings.audit.unavailable'), 'g')) ?? []).length >= 4)) {
      expect.unreachable(
        "Expected (html.match(new RegExp(i18n.t('settings.audit.unavailable'), 'g')) ?? []).length >= 4",
      );
    }
    if (html.includes('settings.audit.')) {
      expect.unreachable("Expected !html.includes('settings.audit.')");
    }
  });

  testCase(`empty audit log renders localized state in ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = render(<AuditLogPage i18n={i18n} data={{ logs: [], members }} />);
    expect(html).toContain(i18n.t('settings.audit.empty'));
    expect(html).toContain(i18n.t('settings.audit.title'));
    if (html.includes('settings.audit.')) {
      expect.unreachable("Expected !html.includes('settings.audit.')");
    }
  });
}

testCase('audit log output differs between English and both Spanish variants', () => {
  const output = (locale: 'en-US' | 'es-ES' | 'es-419') => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    return render(<AuditLogPage i18n={i18n} data={{ logs: [knownLog], members }} />);
  };
  if (!(output('en-US') !== output('es-ES'))) {
    expect.unreachable("Expected output('en-US') !== output('es-ES')");
  }
  if (!(output('en-US') !== output('es-419'))) {
    expect.unreachable("Expected output('en-US') !== output('es-419')");
  }
});
