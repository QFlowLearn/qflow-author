import { mountIsland } from '../../../rendering/mount_island.ts';
import LocalizedTimestampView from '../../../../islands/LocalizedTimestamp.tsx';
import Button from '../../../../components/ui/Button.tsx';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import {
  listActiveSessionsForTenant,
  revokeSessionById,
  revokeSessionsForUserInTenant,
  type TenantSessionRecord,
} from '../../../services/auth_sessions.ts';
import { recordAuditEvent } from '../../../services/audit_logs.ts';
import { requireRole } from '../../../services/roles.ts';
import { requireAuthContext } from '../../../tenants.ts';
import type { I18n } from '../../../i18n/messages.ts';

type Data = {
  sessions: ReadonlyArray<TenantSessionRecord>;
  selfUserId: string;
  error?:
    | 'not_found'
    | 'missing_session'
    | 'missing_user'
    | 'none_for_user'
    | 'unknown_action'
    | null;
  success?: 'revoked' | 'all_revoked' | null;
};

function formatDateTime(value: string, i18n: I18n) {
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return i18n.t('settings.sessions.unavailable');
    return <LocalizedTimestamp value={dt.toISOString()} locale={i18n.locale} />;
  } catch (_err) {
    return i18n.t('settings.sessions.unavailable');
  }
}

const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    const denied = requireRole('admin', auth.role, ctx.req, ctx.state.i18n);
    if (denied) return denied;

    const sessions = await listActiveSessionsForTenant(auth.tenantId);
    return ctx.render(
      <SessionsPage i18n={ctx.state.i18n} data={{ sessions, selfUserId: auth.userId }} />,
    );
  },
  async POST(ctx) {
    const auth = requireAuthContext(ctx.state);
    const denied = requireRole('admin', auth.role, ctx.req, ctx.state.i18n);
    if (denied) return denied;

    const form = await ctx.req.formData();
    const action = String(form.get('action') ?? '').trim();

    if (action === 'revoke') {
      const sessionId = String(form.get('sessionId') ?? '').trim();
      if (!sessionId) {
        const sessions = await listActiveSessionsForTenant(auth.tenantId);
        return ctx.render(
          <SessionsPage
            i18n={ctx.state.i18n}
            data={{ sessions, selfUserId: auth.userId, error: 'missing_session' }}
          />,
        );
      }
      const ok = await revokeSessionById(auth.tenantId, sessionId);
      if (ok) {
        await recordAuditEvent({
          tenantId: auth.tenantId,
          action: 'session_revoked',
          actorUserId: auth.userId,
          ipAddress: ctx.clientIp,
          userAgent: ctx.req.headers.get('user-agent'),
          metadata: { sessionId },
        });
      }
      const sessions = await listActiveSessionsForTenant(auth.tenantId);
      return ctx.render(
        <SessionsPage
          i18n={ctx.state.i18n}
          data={{
            sessions,
            selfUserId: auth.userId,
            success: ok ? 'revoked' : null,
            error: ok ? null : 'not_found',
          }}
        />,
      );
    }

    if (action === 'revoke-user') {
      const userId = String(form.get('userId') ?? '').trim();
      if (!userId) {
        const sessions = await listActiveSessionsForTenant(auth.tenantId);
        return ctx.render(
          <SessionsPage
            i18n={ctx.state.i18n}
            data={{ sessions, selfUserId: auth.userId, error: 'missing_user' }}
          />,
        );
      }
      const count = await revokeSessionsForUserInTenant(auth.tenantId, userId);
      if (count > 0) {
        await recordAuditEvent({
          tenantId: auth.tenantId,
          action: 'session_revoke_user',
          actorUserId: auth.userId,
          targetUserId: userId,
          ipAddress: ctx.clientIp,
          userAgent: ctx.req.headers.get('user-agent'),
          metadata: { count },
        });
      }
      const sessions = await listActiveSessionsForTenant(auth.tenantId);
      return ctx.render(
        <SessionsPage
          i18n={ctx.state.i18n}
          data={{
            sessions,
            selfUserId: auth.userId,
            success: count > 0 ? 'all_revoked' : null,
            error: count > 0 ? null : 'none_for_user',
          }}
        />,
      );
    }

    const sessions = await listActiveSessionsForTenant(auth.tenantId);
    return ctx.render(
      <SessionsPage
        i18n={ctx.state.i18n}
        data={{ sessions, selfUserId: auth.userId, error: 'unknown_action' }}
      />,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const settingsSessionsPageRoute = defineHttpRoute('/settings/sessions', {
  ...methods,
  HEAD: methods.GET,
});

export default function SessionsPage({ data, i18n }: { data: Data; i18n: I18n }) {
  const error = data.error === 'not_found'
    ? i18n.t('settings.sessions.notFound')
    : data.error === 'missing_session'
    ? i18n.t('settings.sessions.missingSessionId')
    : data.error === 'missing_user'
    ? i18n.t('settings.sessions.missingUserId')
    : data.error === 'none_for_user'
    ? i18n.t('settings.sessions.noneForUser')
    : data.error === 'unknown_action'
    ? i18n.t('settings.sessions.unknownAction')
    : null;
  const success = data.success === 'revoked'
    ? i18n.t('settings.sessions.revoked')
    : data.success === 'all_revoked'
    ? i18n.t('settings.sessions.allRevoked')
    : null;
  return (
    <section class='space-y-6'>
      <div class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('settings.sessions.title')}</h1>
        <p class='text-sm text-base-content/70'>
          {i18n.t('settings.sessions.subtitle')}
        </p>
      </div>

      {error && (
        <div class='ds-alert ds-alert-error text-sm'>
          {error}
        </div>
      )}
      {success && (
        <div class='ds-alert text-sm'>
          {success}
        </div>
      )}

      <div class='ds-card ds-card-bordered'>
        <div class='ds-card-body space-y-4'>
          <h2 class='text-lg font-medium'>{i18n.t('settings.sessions.deviceTitle')}</h2>
          {data.sessions.length === 0
            ? <div class='text-sm text-base-content/60'>{i18n.t('settings.sessions.empty')}</div>
            : (
              <div class='overflow-x-auto'>
                <table class='ds-table w-full text-sm'>
                  <thead>
                    <tr>
                      <th>{i18n.t('settings.sessions.user')}</th>
                      <th>{i18n.t('settings.sessions.device')}</th>
                      <th>{i18n.t('settings.sessions.ip')}</th>
                      <th>{i18n.t('settings.sessions.lastSeen')}</th>
                      <th>{i18n.t('settings.sessions.expires')}</th>
                      <th class='text-right'>{i18n.t('settings.sessions.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessions.map((session) => (
                      <tr key={session.id}>
                        <td>
                          <div class='font-medium'>
                            {session.displayName || session.email}
                            {session.userId === data.selfUserId && (
                              <span class='ml-2 ds-badge ds-badge-ghost ds-badge-sm'>
                                {i18n.t('settings.sessions.currentUser')}
                              </span>
                            )}
                          </div>
                          {session.displayName && (
                            <div class='text-xs text-base-content/60'>{session.email}</div>
                          )}
                        </td>
                        <td class='max-w-xs'>
                          <div class='text-xs text-base-content/80 break-words'>
                            {session.userAgent || i18n.t('settings.sessions.unknownDevice')}
                          </div>
                        </td>
                        <td>{session.ipAddress || i18n.t('settings.sessions.unavailable')}</td>
                        <td>{formatDateTime(session.lastSeenAt, i18n)}</td>
                        <td>{formatDateTime(session.expiresAt, i18n)}</td>
                        <td class='text-right'>
                          <div class='flex flex-wrap justify-end gap-2'>
                            <form method='post'>
                              <input type='hidden' name='action' value='revoke' />
                              <input type='hidden' name='sessionId' value={session.id} />
                              <Button variant='ghost' size='sm' class='text-error' type='submit'>
                                {i18n.t('settings.sessions.revoke')}
                              </Button>
                            </form>
                            <form method='post'>
                              <input type='hidden' name='action' value='revoke-user' />
                              <input type='hidden' name='userId' value={session.userId} />
                              <Button variant='ghost' size='sm' type='submit'>
                                {i18n.t('settings.sessions.revokeAll')}
                              </Button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>
    </section>
  );
}

const LocalizedTimestamp = mountIsland({
  component: 'LocalizedTimestamp',
  View: LocalizedTimestampView,
});
