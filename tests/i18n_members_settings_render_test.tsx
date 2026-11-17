import { expect, test as testCase } from 'vitest';
import { makeHttpRequest } from './helpers/http_route.ts';

import { renderPage as render } from './helpers/render_page.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import type { MemberRecord } from '../lib/services/memberships.ts';
import MembersPage, {
  settingsMembersPageRoute as handlerEndpoint,
} from '../lib/http/routes/settings_pages/members.tsx';

const handler = handlerEndpoint.handle;

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
const errors = [
  'invalid_email',
  'exists',
  'create_failed',
  'missing_id',
  'last_owner',
  'update_failed',
  'self_remove',
  'remove_failed',
  'unknown_action',
  'forbidden',
] as const;
const members: MemberRecord[] = [
  {
    userId: 'self-user',
    email: 'owner@example.test',
    displayName: 'Owner Example',
    role: 'owner',
    canPublishEditions: false,
    joinedAt: '2026-01-02T03:04:00.000Z',
  },
  {
    userId: 'member-user',
    email: 'member@example.test',
    displayName: null,
    role: 'instructor',
    canPublishEditions: false,
    joinedAt: 'not-a-date',
  },
];
const baseData = { members, selfUserId: 'self-user' };
const successes = {
  created: 'settings.members.success.created',
  role_updated: 'settings.members.success.roleUpdated',
  removed: 'settings.members.success.removed',
} as const;

for (const locale of locales) {
  testCase(`members page renders owner populated state in ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = render(<MembersPage i18n={i18n} data={baseData} />);
    for (
      const id of [
        'title',
        'subtitle',
        'addMember',
        'currentMembers',
        'member',
        'role',
        'joined',
        'actions',
        'email',
        'owner',
        'memberRole',
        'save',
        'remove',
        'you',
        'createUser',
        'firstSignIn',
        'unavailable',
      ]
    ) expect(html).toContain(i18n.t(`settings.members.${id}`));
    expect(html).toContain(i18n.formatDate(new Date('2026-01-02T03:04:00.000Z'), {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }));
    expect(html).toContain('Owner Example');
    expect(html).toContain('owner@example.test');
    expect(html).toContain('member@example.test');
    if (html.includes('not-a-date')) {
      expect.unreachable("Expected !html.includes('not-a-date')");
    }
    if (html.includes('settings.members.')) {
      expect.unreachable("Expected !html.includes('settings.members.')");
    }
  });

  testCase(`members page renders empty state and temporary password in ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = render(
      <MembersPage
        i18n={i18n}
        data={{
          members: [],
          selfUserId: 'self-user',
          success: 'created',
          credentials: { email: 'new@example.test', password: 'Temp-Password-42' },
        }}
      />,
    );
    expect(html).toContain(i18n.t('settings.members.empty'));
    expect(html).toContain(i18n.t('settings.members.success.created'));
    expect(html).toContain(
      i18n.t('settings.members.tempPasswordTitle', { email: 'new@example.test' }),
    );
    expect(html).toContain(i18n.t('settings.members.tempPasswordHelp'));
    expect(html).toContain('new@example.test');
    expect(html).toContain('Temp-Password-42');
    expect(html).toContain('role="status"');
    if (html.includes('settings.members.')) {
      expect.unreachable("Expected !html.includes('settings.members.')");
    }
  });

  testCase(`members page renders every success code in ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    for (const [code, id] of Object.entries(successes)) {
      const html = render(
        <MembersPage i18n={i18n} data={{ ...baseData, success: code as keyof typeof successes }} />,
      );
      expect(html).toContain(i18n.t(id));
      expect(html).toContain('role="status"');
      if (html.includes('settings.members.')) {
        expect.unreachable("Expected !html.includes('settings.members.')");
      }
    }
  });

  testCase(`members page renders every feedback code in ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    for (const code of errors) {
      const html = render(<MembersPage i18n={i18n} data={{ ...baseData, error: code }} />);
      expect(html).toContain(i18n.t(
        `settings.members.error.${
          code === 'invalid_email'
            ? 'invalidEmail'
            : code === 'create_failed'
            ? 'createFailed'
            : code === 'missing_id'
            ? 'missingId'
            : code === 'last_owner'
            ? 'lastOwner'
            : code === 'update_failed'
            ? 'updateFailed'
            : code === 'self_remove'
            ? 'selfRemove'
            : code === 'remove_failed'
            ? 'removeFailed'
            : code === 'unknown_action'
            ? 'unknownAction'
            : code
        }`,
      ));
      expect(html).toContain('role="alert"');
      if (html.includes('settings.members.')) {
        expect.unreachable("Expected !html.includes('settings.members.')");
      }
    }
  });
}

for (const locale of locales) {
  testCase(`members owner denial responses are localized in ${locale}`, async () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const state = {
      auth: { tenantId: 'tenant-test', userId: 'user-test', role: 'instructor' as const },
      interfaceLocale: locale,
      catalog: catalogForLocale(locale),
      i18n,
    };
    const getReq = new Request('https://example.test/settings/members');
    const getResponse = await handler(makeHttpRequest(getReq, { state: state, auth: state.auth }));
    expect(getResponse.status).toStrictEqual(403);
    expect(await getResponse.text()).toStrictEqual(i18n.t('settings.members.error.forbidden'));
    const postReq = new Request('https://example.test/settings/members', {
      ...{ duplex: 'half' },
      method: 'POST',
      body: new FormData(),
    });
    const postResponse = await handler(
      makeHttpRequest(postReq, { state: state, auth: state.auth }),
    );
    expect(postResponse.status).toStrictEqual(403);
    expect(await postResponse.text()).toStrictEqual(i18n.t('settings.members.error.forbidden'));
  });
}

testCase('members settings copy differs between English and Spanish', () => {
  const en = createI18n('en-US', catalogForLocale('en-US'));
  const es = createI18n('es-ES', catalogForLocale('es-ES'));
  if (
    !(render(<MembersPage i18n={en} data={baseData} />) !==
      render(<MembersPage i18n={es} data={baseData} />))
  ) {
    expect.unreachable(
      'Expected render(<MembersPage i18n={en} data={baseData} />) !== render(<MembersPage i18n={es} data={',
    );
  }
});
