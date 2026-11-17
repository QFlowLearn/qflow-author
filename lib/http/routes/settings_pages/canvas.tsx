import { defineHttpRoute, type HttpHandler } from '../../route.ts';

import Button from '../../../../components/ui/Button.tsx';
import Input from '../../../../components/ui/Input.tsx';
import {
  type CanvasConnectionSettings,
  createCanvasConnection,
  disconnectCanvasConnection,
  listCanvasConnectionSettings,
  parseCanvasConnectionId,
  rotateCanvasDeveloperKey,
  setCanvasConnectionLifecycle,
} from '../../../lms/canvas_connections.ts';
import { redact } from '../../../redacted.ts';
import { roleAtLeast } from '../../../roles.ts';
import { requireAuthContext } from '../../../tenants.ts';
import type { I18n } from '../../../i18n/messages.ts';

type CanvasNoticeCode =
  | 'connected'
  | 'created'
  | 'disconnected'
  | 'enabled'
  | 'disabled'
  | 'rotated';
type CanvasErrorCode =
  | 'state-invalid'
  | 'authorization-declined'
  | 'authorization-unavailable'
  | 'authorization-failed'
  | 'create-failed'
  | 'connection-not-found'
  | 'rotation-conflict'
  | 'configuration-invalid'
  | 'persistence-unavailable'
  | 'save-failed'
  | 'forbidden'
  | 'unsupported-action'
  | 'list-unavailable';

const NOTICE_MESSAGE_IDS: Record<CanvasNoticeCode, string> = {
  connected: 'settings.canvas.notice.connected',
  created: 'settings.canvas.notice.created',
  disconnected: 'settings.canvas.notice.disconnected',
  enabled: 'settings.canvas.notice.enabled',
  disabled: 'settings.canvas.notice.disabled',
  rotated: 'settings.canvas.notice.rotated',
};
const ERROR_MESSAGE_IDS: Record<CanvasErrorCode, string> = {
  'state-invalid': 'settings.canvas.error.stateInvalid',
  'authorization-declined': 'settings.canvas.error.authorizationDeclined',
  'authorization-unavailable': 'settings.canvas.error.siteUnavailable',
  'authorization-failed': 'settings.canvas.error.authorizationFailed',
  'create-failed': 'settings.canvas.error.createFailed',
  'connection-not-found': 'settings.canvas.error.connectionNotFound',
  'rotation-conflict': 'settings.canvas.error.rotationConflict',
  'configuration-invalid': 'settings.canvas.error.configurationInvalid',
  'persistence-unavailable': 'settings.canvas.error.persistenceUnavailable',
  'save-failed': 'settings.canvas.error.saveFailed',
  forbidden: 'settings.canvas.error.forbidden',
  'unsupported-action': 'settings.canvas.error.unsupportedAction',
  'list-unavailable': 'settings.canvas.error.listUnavailable',
};

type Data = {
  readonly connections: readonly CanvasConnectionSettings[];
  readonly canManage: boolean;
  readonly redirectUri: string;
  readonly notice: CanvasNoticeCode | null;
  readonly error: CanvasErrorCode | null;
};

const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    const listed = await listCanvasConnectionSettings(auth, ctx);
    if (!listed.ok) {
      return new Response(ctx.state.i18n.t(ERROR_MESSAGE_IDS['list-unavailable']), { status: 503 });
    }
    return ctx.render(
      <CanvasSettingsPage
        i18n={ctx.state.i18n}
        data={{
          connections: listed.value,
          canManage: roleAtLeast(auth.role, 'admin'),
          redirectUri: new URL('/auth/canvas/callback', ctx.url.origin).toString(),
          notice: noticeFromUrl(ctx.url),
          error: errorFromUrl(ctx.url),
        }}
      />,
    );
  },
  async POST(ctx) {
    const auth = requireAuthContext(ctx.state);
    const form = await ctx.req.formData();
    const action = String(form.get('action') ?? '');
    try {
      if (action === 'create') {
        if (!roleAtLeast(auth.role, 'admin')) {
          return new Response(ctx.state.i18n.t(ERROR_MESSAGE_IDS.forbidden), { status: 403 });
        }
        const result = await createCanvasConnection(auth, {
          name: String(form.get('name') ?? ''),
          baseUrl: String(form.get('baseUrl') ?? ''),
          clientId: String(form.get('clientId') ?? ''),
          clientSecret: redact(String(form.get('clientSecret') ?? '')),
        }, ctx);
        return result.ok
          ? redirect(ctx.url.origin, 'created')
          : redirect(ctx.url.origin, null, createErrorKey(result.error._tag));
      }
      const connectionId = parseCanvasConnectionId(form.get('connectionId'));
      if (!connectionId) return redirect(ctx.url.origin, null, 'connection-invalid');
      if (action === 'rotate') {
        if (!roleAtLeast(auth.role, 'admin')) {
          return new Response(ctx.state.i18n.t(ERROR_MESSAGE_IDS.forbidden), { status: 403 });
        }
        const result = await rotateCanvasDeveloperKey(auth, connectionId, {
          clientId: String(form.get('clientId') ?? ''),
          clientSecret: redact(String(form.get('clientSecret') ?? '')),
          expectedCredentialVersion: Number(form.get('credentialVersion')),
        }, ctx);
        if (result.ok) return redirect(ctx.url.origin, 'rotated');
        return redirect(ctx.url.origin, null, rotationErrorKey(result.error._tag));
      }
      if (action === 'disconnect') {
        const result = await disconnectCanvasConnection(auth, connectionId, ctx);
        return result.ok
          ? redirect(ctx.url.origin, 'disconnected')
          : redirect(ctx.url.origin, null, 'save-failed');
      }
      if (action === 'enable' || action === 'disable') {
        if (!roleAtLeast(auth.role, 'admin')) {
          return new Response(ctx.state.i18n.t(ERROR_MESSAGE_IDS.forbidden), { status: 403 });
        }
        const changed = await setCanvasConnectionLifecycle(
          auth,
          connectionId,
          action === 'enable' ? 'active' : 'disabled',
          ctx,
        );
        return changed.ok
          ? redirect(ctx.url.origin, action === 'enable' ? 'enabled' : 'disabled')
          : redirect(
            ctx.url.origin,
            null,
            changed.error._tag === 'CanvasConnectionNotFound'
              ? 'connection-not-found'
              : 'save-failed',
          );
      }
      return new Response(ctx.state.i18n.t(ERROR_MESSAGE_IDS['unsupported-action']), {
        status: 400,
      });
    } catch (_cause: unknown) {
      return redirect(ctx.url.origin, null, action === 'create' ? 'create-failed' : 'save-failed');
    }
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const settingsCanvasPageRoute = defineHttpRoute('/settings/canvas', {
  ...methods,
  HEAD: methods.GET,
});

export default function CanvasSettingsPage(
  { data, i18n }: { readonly data: Data; readonly i18n: I18n },
) {
  return (
    <section class='max-w-4xl space-y-8'>
      <header class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('settings.canvas.title')}</h1>
        <p class='max-w-2xl text-sm leading-6 text-base-content/70'>
          {i18n.t('settings.canvas.subtitle')}
        </p>
      </header>

      {data.notice && (
        <div class='ds-alert ds-alert-success text-sm' role='status'>
          {i18n.t(NOTICE_MESSAGE_IDS[data.notice])}
        </div>
      )}
      {data.error && (
        <div class='ds-alert ds-alert-error text-sm' role='alert'>
          {i18n.t(ERROR_MESSAGE_IDS[data.error])}
        </div>
      )}

      <section aria-labelledby='canvas-sites-heading' class='space-y-3'>
        <div>
          <h2 id='canvas-sites-heading' class='text-xl font-medium'>
            {i18n.t('settings.canvas.availableSites')}
          </h2>
          <p class='mt-1 text-sm text-base-content/70'>
            {i18n.t('settings.canvas.availableSitesHelp')}
          </p>
        </div>
        {data.connections.length === 0
          ? (
            <div class='rounded-lg border border-base-300 bg-base-100 p-5'>
              <p class='font-medium'>{i18n.t('settings.canvas.empty')}</p>
              <p class='mt-1 text-sm text-base-content/70'>
                {data.canManage
                  ? i18n.t('settings.canvas.emptyAdminGuidance')
                  : i18n.t('settings.canvas.emptyMemberGuidance')}
              </p>
            </div>
          )
          : (
            <ul class='divide-y divide-base-300 rounded-lg border border-base-300 bg-base-100'>
              {data.connections.map((connection) => (
                <li class='space-y-4 p-5' key={connection.id}>
                  <div class='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
                    <div class='min-w-0'>
                      <div class='flex flex-wrap items-center gap-2'>
                        <h3 class='font-medium'>{connection.name}</h3>
                        <span
                          class={`ds-badge ds-badge-sm ${
                            connection.lifecycleState === 'active' ? 'ds-badge-success' : ''
                          }`}
                        >
                          {connection.lifecycleState === 'active'
                            ? i18n.t('settings.canvas.active')
                            : i18n.t('settings.canvas.disabled')}
                        </span>
                        {connection.currentUserAuthorized && (
                          <span class='ds-badge ds-badge-sm ds-badge-outline'>
                            {i18n.t('settings.canvas.connected')}
                          </span>
                        )}
                      </div>
                      <p class='mt-1 truncate text-sm text-base-content/70'>
                        {new URL(connection.baseUrl).hostname}
                      </p>
                    </div>
                    <div class='flex flex-wrap items-center gap-2'>
                      {connection.lifecycleState === 'active' &&
                        !connection.currentUserAuthorized && (
                        <Button variant='primary' size='sm' href={`/auth/canvas/${connection.id}`}>
                          {i18n.t('settings.canvas.connect')}
                        </Button>
                      )}
                      {connection.currentUserAuthorized && (
                        <form method='post'>
                          <input type='hidden' name='action' value='disconnect' />
                          <input type='hidden' name='connectionId' value={connection.id} />
                          <Button type='submit' size='sm'>
                            {i18n.t('settings.canvas.disconnect')}
                          </Button>
                        </form>
                      )}
                      {data.canManage && (
                        <form method='post'>
                          <input
                            type='hidden'
                            name='action'
                            value={connection.lifecycleState === 'active' ? 'disable' : 'enable'}
                          />
                          <input type='hidden' name='connectionId' value={connection.id} />
                          <Button type='submit' variant='ghost' size='sm'>
                            {connection.lifecycleState === 'active'
                              ? i18n.t('settings.canvas.disable')
                              : i18n.t('settings.canvas.enable')}
                          </Button>
                        </form>
                      )}
                    </div>
                  </div>
                  {data.canManage && (
                    <details class='rounded-md border border-base-300 p-4'>
                      <summary class='cursor-pointer text-sm font-medium'>
                        {i18n.t('settings.canvas.replaceKey')}
                      </summary>
                      <p class='mt-2 max-w-2xl text-sm leading-6 text-base-content/70'>
                        {i18n.t('settings.canvas.replaceKeyHelp')}
                      </p>
                      <form method='post' class='mt-4 grid gap-4 sm:grid-cols-2'>
                        <input type='hidden' name='action' value='rotate' />
                        <input type='hidden' name='connectionId' value={connection.id} />
                        <input
                          type='hidden'
                          name='credentialVersion'
                          value={connection.credentialVersion}
                        />
                        <label class='flex flex-col'>
                          <span>{i18n.t('settings.canvas.newClientId')}</span>
                          <Input name='clientId' required maxLength={255} autoComplete='off' />
                        </label>
                        <label class='flex flex-col'>
                          <span>{i18n.t('settings.canvas.newClientSecret')}</span>
                          <Input
                            name='clientSecret'
                            type='password'
                            required
                            autoComplete='new-password'
                          />
                        </label>
                        <div class='sm:col-span-2'>
                          <Button type='submit' variant='primary' size='sm'>
                            {i18n.t('settings.canvas.replaceKeySubmit')}
                          </Button>
                        </div>
                      </form>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>

      {data.canManage && (
        <section aria-labelledby='add-canvas-heading' class='space-y-3'>
          <div>
            <h2 id='add-canvas-heading' class='text-xl font-medium'>
              {i18n.t('settings.canvas.addSite')}
            </h2>
            <p class='mt-1 max-w-2xl text-sm leading-6 text-base-content/70'>
              {i18n.t('settings.canvas.addSiteHelp')}
            </p>
            <p class='mt-2 max-w-2xl text-sm leading-6 text-base-content/70'>
              {i18n.t('settings.canvas.redirectUriInstruction')}{' '}
              <code class='break-all text-xs'>{data.redirectUri}</code>
            </p>
          </div>
          <form method='post' class='rounded-lg border border-base-300 bg-base-100 p-5'>
            <input type='hidden' name='action' value='create' />
            <div class='grid gap-4 sm:grid-cols-2'>
              <label class='flex flex-col sm:col-span-2'>
                <span>{i18n.t('settings.canvas.connectionName')}</span>
                <Input
                  name='name'
                  required
                  maxLength={120}
                  autoComplete='off'
                  placeholder={i18n.t('settings.canvas.connectionNamePlaceholder')}
                />
              </label>
              <label class='flex flex-col sm:col-span-2'>
                <span>{i18n.t('settings.canvas.canvasUrl')}</span>
                <Input
                  name='baseUrl'
                  type='url'
                  required
                  placeholder='https://canvas.example.edu'
                />
                <span class='mt-1 text-xs text-base-content/65'>
                  {i18n.t('settings.canvas.canvasUrlHelp')}
                </span>
              </label>
              <label class='flex flex-col'>
                <span>{i18n.t('settings.canvas.clientId')}</span>
                <Input name='clientId' required maxLength={255} autoComplete='off' />
              </label>
              <label class='flex flex-col'>
                <span>{i18n.t('settings.canvas.clientSecret')}</span>
                <Input name='clientSecret' type='password' required autoComplete='new-password' />
              </label>
            </div>
            <div class='mt-5'>
              <Button type='submit' variant='primary'>
                {i18n.t('settings.canvas.addSiteSubmit')}
              </Button>
            </div>
          </form>
        </section>
      )}
    </section>
  );
}

function redirect(origin: string, notice: string | null, error?: string): Response {
  const url = new URL('/settings/canvas', origin);
  if (notice) url.searchParams.set(notice, '1');
  if (error) url.searchParams.set('error', error);
  return new Response(null, {
    status: 303,
    headers: { location: url.pathname + url.search },
  });
}

/** Map a Canvas status query to its closed notice code. */
export function noticeFromUrl(url: URL): CanvasNoticeCode | null {
  if (url.searchParams.get('connected') === '1') return 'connected';
  if (url.searchParams.get('created') === '1') return 'created';
  if (url.searchParams.get('disconnected') === '1') return 'disconnected';
  if (url.searchParams.get('enabled') === '1') return 'enabled';
  if (url.searchParams.get('disabled') === '1') return 'disabled';
  if (url.searchParams.get('rotated') === '1') return 'rotated';
  return null;
}

/** Map untrusted Canvas status query input to a closed presentation code. */
export function errorFromUrl(url: URL): CanvasErrorCode | null {
  const error = url.searchParams.get('error');
  if (!error) return null;
  if (error === 'state-invalid') return 'state-invalid';
  if (error === 'authorization-declined') return 'authorization-declined';
  if (error === 'authorization-unavailable') return 'authorization-unavailable';
  if (error === 'authorization-failed') return 'authorization-failed';
  if (error === 'create-failed') return 'create-failed';
  if (error === 'connection-not-found') return 'connection-not-found';
  if (error === 'rotation-conflict') return 'rotation-conflict';
  if (error === 'configuration-invalid') return 'configuration-invalid';
  if (error === 'persistence-unavailable') return 'persistence-unavailable';
  return 'save-failed';
}

function rotationErrorKey(tag: string): string {
  if (tag === 'CanvasCredentialRotationConflict') return 'rotation-conflict';
  if (tag === 'CanvasConfigurationInvalid') return 'configuration-invalid';
  if (tag === 'CanvasPersistenceUnavailable') return 'persistence-unavailable';
  if (tag === 'CanvasConnectionNotFound') return 'connection-not-found';
  return 'save-failed';
}

function createErrorKey(tag: string): string {
  if (tag === 'CanvasConfigurationInvalid') return 'configuration-invalid';
  if (tag === 'CanvasPersistenceUnavailable') return 'persistence-unavailable';
  return 'create-failed';
}
