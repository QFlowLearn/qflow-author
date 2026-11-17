import { expect, test as testCase } from 'vitest';
import { makeHttpRequest } from './helpers/http_route.ts';

import { renderPage as render } from './helpers/render_page.tsx';
import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import {
  type CanvasConnectionSettings,
  parseCanvasConnectionId,
} from '../lib/lms/canvas_connections.ts';
import CanvasSettingsPage, {
  errorFromUrl,
  noticeFromUrl,
  settingsCanvasPageRoute as handlerEndpoint,
} from '../lib/http/routes/settings_pages/canvas.tsx';

const handler = handlerEndpoint.handle;

const locales = ['en-US', 'en-GB', 'es-ES', 'es-419'] as const;
const notices = ['connected', 'created', 'disconnected', 'enabled', 'disabled', 'rotated'] as const;
const errors = [
  'state-invalid',
  'authorization-declined',
  'authorization-unavailable',
  'authorization-failed',
  'create-failed',
  'connection-not-found',
  'rotation-conflict',
  'configuration-invalid',
  'persistence-unavailable',
  'save-failed',
  'forbidden',
  'unsupported-action',
  'list-unavailable',
] as const;
const connectionId = parseCanvasConnectionId('11111111-1111-4111-8111-111111111111');
if (!connectionId) throw new Error('Test fixture connection ID is invalid');

const connections: CanvasConnectionSettings[] = [
  {
    id: connectionId,
    name: 'District Canvas',
    baseUrl: 'https://canvas.example.edu',
    supportedTargetIds: [],
    lifecycleState: 'active',
    currentUserAuthorized: false,
    credentialVersion: 2,
  },
  {
    id: parseCanvasConnectionId('22222222-2222-4222-8222-222222222222')!,
    name: 'Connected Canvas',
    baseUrl: 'https://connected.example.edu',
    supportedTargetIds: [],
    lifecycleState: 'active',
    currentUserAuthorized: true,
    credentialVersion: 3,
  },
  {
    id: parseCanvasConnectionId('33333333-3333-4333-8333-333333333333')!,
    name: 'Legacy Canvas',
    baseUrl: 'https://legacy.example.edu',
    supportedTargetIds: [],
    lifecycleState: 'disabled',
    currentUserAuthorized: false,
    credentialVersion: 1,
  },
];

const baseData = {
  connections,
  canManage: true,
  redirectUri: 'https://qflow.example.test/auth/canvas/callback',
  notice: null,
  error: null,
};

for (const locale of locales) {
  testCase(`Canvas settings renders admin empty state in ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = render(
      <CanvasSettingsPage
        i18n={i18n}
        data={{ ...baseData, connections: [], canManage: true }}
      />,
    );
    for (
      const id of [
        'title',
        'subtitle',
        'availableSites',
        'availableSitesHelp',
        'empty',
        'emptyAdminGuidance',
        'addSite',
        'addSiteHelp',
        'redirectUriInstruction',
        'connectionName',
        'connectionNamePlaceholder',
        'canvasUrl',
        'canvasUrlHelp',
        'clientId',
        'clientSecret',
        'addSiteSubmit',
      ]
    ) expect(html).toContain(i18n.t(`settings.canvas.${id}`));
    expect(html).toContain(baseData.redirectUri);
    if (html.includes('settings.canvas.')) {
      expect.unreachable("Expected !html.includes('settings.canvas.')");
    }
  });

  testCase(`Canvas settings renders member empty state in ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = render(
      <CanvasSettingsPage
        i18n={i18n}
        data={{ ...baseData, connections: [], canManage: false }}
      />,
    );
    expect(html).toContain(i18n.t('settings.canvas.emptyMemberGuidance'));
    if (html.includes(i18n.t('settings.canvas.emptyAdminGuidance'))) {
      expect.unreachable("Expected !html.includes(i18n.t('settings.canvas.emptyAdminGuidance'))");
    }
    if (html.includes('settings.canvas.')) {
      expect.unreachable("Expected !html.includes('settings.canvas.')");
    }
  });

  testCase(`Canvas settings renders populated states in ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    const html = render(<CanvasSettingsPage i18n={i18n} data={baseData} />);
    for (
      const id of [
        'active',
        'disabled',
        'connected',
        'connect',
        'disconnect',
        'disable',
        'replaceKey',
        'replaceKeyHelp',
        'newClientId',
        'newClientSecret',
        'replaceKeySubmit',
      ]
    ) expect(html).toContain(i18n.t(`settings.canvas.${id}`));
    expect(html).toContain(i18n.t('settings.canvas.enable'));
    for (
      const value of [
        'District Canvas',
        'canvas.example.edu',
        'Connected Canvas',
        'connected.example.edu',
        'Legacy Canvas',
        'legacy.example.edu',
      ]
    ) {
      expect(html).toContain(value);
    }
    if (html.includes('settings.canvas.')) {
      expect.unreachable("Expected !html.includes('settings.canvas.')");
    }
  });

  testCase(`Canvas settings renders all status codes in ${locale}`, () => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    for (const code of notices) {
      const html = render(<CanvasSettingsPage i18n={i18n} data={{ ...baseData, notice: code }} />);
      expect(html).toContain(i18n.t(`settings.canvas.notice.${code}`));
      if (html.includes('settings.canvas.')) {
        expect.unreachable("Expected !html.includes('settings.canvas.')");
      }
    }
    for (const code of errors) {
      const html = render(<CanvasSettingsPage i18n={i18n} data={{ ...baseData, error: code }} />);
      expect(html).toContain(i18n.t(
        `settings.canvas.error.${
          code === 'authorization-unavailable'
            ? 'siteUnavailable'
            : code === 'state-invalid'
            ? 'stateInvalid'
            : code === 'authorization-declined'
            ? 'authorizationDeclined'
            : code === 'authorization-failed'
            ? 'authorizationFailed'
            : code === 'create-failed'
            ? 'createFailed'
            : code === 'connection-not-found'
            ? 'connectionNotFound'
            : code === 'rotation-conflict'
            ? 'rotationConflict'
            : code === 'configuration-invalid'
            ? 'configurationInvalid'
            : code === 'persistence-unavailable'
            ? 'persistenceUnavailable'
            : code === 'save-failed'
            ? 'saveFailed'
            : code === 'unsupported-action'
            ? 'unsupportedAction'
            : code === 'list-unavailable'
            ? 'listUnavailable'
            : code
        }`,
      ));
      if (html.includes('settings.canvas.')) {
        expect.unreachable("Expected !html.includes('settings.canvas.')");
      }
    }
  });
}

testCase('hostile Canvas error query maps to generic save failure without reflection', () => {
  const result = errorFromUrl(
    new URL('https://example.test/settings/canvas?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E'),
  );
  expect(result).toStrictEqual('save-failed');
  if (String(result).includes('script')) {
    expect.unreachable("Expected !String(result).includes('script')");
  }
});

testCase('Canvas status query parser recognizes every stable value', () => {
  for (const code of notices) {
    expect(noticeFromUrl(new URL(`https://example.test/settings/canvas?${code}=1`))).toStrictEqual(
      code,
    );
  }
  const queryNames = [
    'state-invalid',
    'authorization-declined',
    'authorization-unavailable',
    'authorization-failed',
    'create-failed',
    'connection-not-found',
    'rotation-conflict',
    'configuration-invalid',
    'persistence-unavailable',
  ] as const;
  for (const code of queryNames) {
    expect(errorFromUrl(new URL(`https://example.test/settings/canvas?error=${code}`)))
      .toStrictEqual(code);
  }
});

function requestContext(
  locale: (typeof locales)[number],
  req: Request,
  runtime?: { bindings: Record<string, unknown> },
) {
  return makeHttpRequest(req, {
    auth: { tenantId: 'tenant-test', userId: 'user-test', role: 'teaching_assistant' },
    state: {
      interfaceLocale: locale,
      catalog: catalogForLocale(locale),
      i18n: createI18n(locale, catalogForLocale(locale)),
      runtime,
    },
  });
}

for (const locale of locales) {
  testCase(`Canvas handler returns localized authorization responses in ${locale}`, async () => {
    const unavailable = await handler(
      requestContext(
        locale,
        new Request('https://example.test/settings/canvas'),
        { bindings: { QFLOW_DB: { connectionString: 'not-a-valid-database-url' } } },
      ),
    );
    expect(unavailable.status).toStrictEqual(503);
    const unavailableBody = await unavailable.text();
    expect(unavailableBody).toStrictEqual(
      createI18n(locale, catalogForLocale(locale)).t('settings.canvas.error.listUnavailable'),
    );
    if (unavailableBody.includes('not-a-valid-database-url')) {
      expect.unreachable("Expected !unavailableBody.includes('not-a-valid-database-url')");
    }
    if (unavailableBody.includes('settings.canvas.')) {
      expect.unreachable("Expected !unavailableBody.includes('settings.canvas.')");
    }

    for (const action of ['create', 'rotate', 'enable', 'disable'] as const) {
      const form = new FormData();
      form.set('action', action);
      if (action !== 'create') form.set('connectionId', connectionId);
      const forbidden = await handler(
        requestContext(
          locale,
          new Request('https://example.test/settings/canvas', {
            ...{ duplex: 'half' },
            method: 'POST',
            body: form,
          }),
        ),
      );
      expect(forbidden.status).toStrictEqual(403);
      const body = await forbidden.text();
      expect(body).toStrictEqual(
        createI18n(locale, catalogForLocale(locale)).t('settings.canvas.error.forbidden'),
      );
      if (body.includes('settings.canvas.')) {
        expect.unreachable("Expected !body.includes('settings.canvas.')");
      }
    }

    const unsupportedForm = new FormData();
    unsupportedForm.set('action', 'future-action');
    unsupportedForm.set('connectionId', connectionId);
    const unsupported = await handler(
      requestContext(
        locale,
        new Request('https://example.test/settings/canvas', {
          ...{ duplex: 'half' },
          method: 'POST',
          body: unsupportedForm,
        }),
      ),
    );
    expect(unsupported.status).toStrictEqual(400);
    const unsupportedBody = await unsupported.text();
    expect(unsupportedBody).toStrictEqual(
      createI18n(locale, catalogForLocale(locale)).t('settings.canvas.error.unsupportedAction'),
    );
    if (unsupportedBody.includes('settings.canvas.')) {
      expect.unreachable("Expected !unsupportedBody.includes('settings.canvas.')");
    }
  });
}

testCase('Canvas settings output differs between English and Spanish', () => {
  const output = (locale: 'en-US' | 'es-ES' | 'es-419') => {
    const i18n = createI18n(locale, catalogForLocale(locale));
    return render(<CanvasSettingsPage i18n={i18n} data={baseData} />);
  };
  if (!(output('en-US') !== output('es-ES'))) {
    expect.unreachable("Expected output('en-US') !== output('es-ES')");
  }
  if (!(output('en-US') !== output('es-419'))) {
    expect.unreachable("Expected output('en-US') !== output('es-419')");
  }
});
