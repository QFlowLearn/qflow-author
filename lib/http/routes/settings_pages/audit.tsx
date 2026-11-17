import { mountIsland } from '../../../rendering/mount_island.ts';
import LocalizedTimestampView from '../../../../islands/LocalizedTimestamp.tsx';
import Button from '../../../../components/ui/Button.tsx';
import Select from '../../../../components/ui/Select.tsx';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { type AuditLogRecord, listAuditEvents } from '../../../services/audit_logs.ts';
import { listMembers, type MemberRecord } from '../../../services/memberships.ts';
import { requireRole } from '../../../services/roles.ts';
import { requireAuthContext } from '../../../tenants.ts';
import type { I18n } from '../../../i18n/messages.ts';

type Data = {
  logs: AuditLogRecord[];
  members: MemberRecord[];
  action?: string | null;
  userId?: string | null;
};

const ACTION_VALUES = [
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

function formatDateTime(value: string, i18n: I18n) {
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return i18n.t('settings.audit.unavailable');
    return <LocalizedTimestamp value={dt.toISOString()} locale={i18n.locale} />;
  } catch (_err) {
    return i18n.t('settings.audit.unavailable');
  }
}

function displayUser(
  name: string | null | undefined,
  email: string | null | undefined,
  i18n: I18n,
): string {
  if (name && email) return `${name} (${email})`;
  return name || email || i18n.t('settings.audit.unavailable');
}

function displayAction(action: string, i18n: I18n): string {
  if ((ACTION_VALUES as readonly string[]).includes(action)) {
    return i18n.t(`settings.audit.action.${action}`);
  }
  return action;
}

const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    const denied = requireRole('admin', auth.role, ctx.req, ctx.state.i18n);
    if (denied) return denied;

    const url = ctx.url;
    const action = url.searchParams.get('action');
    const userId = url.searchParams.get('userId');

    const [members, logs] = await Promise.all([
      listMembers(auth.tenantId),
      listAuditEvents({
        tenantId: auth.tenantId,
        action: action || undefined,
        userId: userId || undefined,
        limit: 200,
      }),
    ]);

    return ctx.render(
      <AuditLogPage data={{ logs, members, action, userId }} i18n={ctx.state.i18n} />,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const settingsAuditPageRoute = defineHttpRoute('/settings/audit', {
  ...methods,
  HEAD: methods.GET,
});

export default function AuditLogPage({ data, i18n }: { data: Data; i18n: I18n }) {
  return (
    <section class='space-y-6'>
      <div class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('settings.audit.title')}</h1>
        <p class='text-sm text-base-content/70'>
          {i18n.t('settings.audit.subtitle')}
        </p>
      </div>

      <form method='get' class='ds-card ds-card-border'>
        <div class='ds-card-body space-y-4'>
          <div class='grid gap-4 md:grid-cols-2'>
            <label class='flex flex-col'>
              <span>{i18n.t('settings.audit.user')}</span>
              <Select name='userId' size='sm' defaultValue={data.userId ?? ''}>
                <option value=''>{i18n.t('settings.audit.allUsers')}</option>
                {data.members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName || member.email}
                  </option>
                ))}
              </Select>
            </label>
            <label class='flex flex-col'>
              <span>{i18n.t('settings.audit.action')}</span>
              <Select name='action' size='sm' defaultValue={data.action ?? ''}>
                <option value=''>{i18n.t('settings.audit.allActions')}</option>
                {ACTION_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {i18n.t(`settings.audit.action.${value}`)}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </div>
        <div class='ds-card-actions justify-between border-t border-base-200 px-6 py-4'>
          <Button type='submit' variant='primary'>{i18n.t('settings.audit.apply')}</Button>
          <Button type='button' variant='ghost' href='/settings/audit'>
            {i18n.t('settings.audit.clear')}
          </Button>
        </div>
      </form>

      <div class='ds-card ds-card-border'>
        <div class='ds-card-body space-y-4'>
          <h2 class='text-lg font-medium'>{i18n.t('settings.audit.recent')}</h2>
          {data.logs.length === 0
            ? (
              <div class='py-4 text-sm text-base-content/60'>
                {i18n.t('settings.audit.empty')}
              </div>
            )
            : (
              <div class='overflow-x-auto'>
                <table class='ds-table w-full text-sm'>
                  <thead>
                    <tr>
                      <th>{i18n.t('settings.audit.date')}</th>
                      <th>{i18n.t('settings.audit.action')}</th>
                      <th>{i18n.t('settings.audit.actor')}</th>
                      <th>{i18n.t('settings.audit.target')}</th>
                      <th>{i18n.t('settings.audit.ip')}</th>
                      <th>{i18n.t('settings.audit.details')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.logs.map((log) => (
                      <tr key={log.id}>
                        <td>{formatDateTime(log.createdAt, i18n)}</td>
                        <td>{displayAction(log.action, i18n)}</td>
                        <td>{displayUser(log.actorName, log.actorEmail, i18n)}</td>
                        <td>{displayUser(log.targetName, log.targetEmail, i18n)}</td>
                        <td>{log.ipAddress || i18n.t('settings.audit.unavailable')}</td>
                        <td class='max-w-xs'>
                          <div class='text-xs text-base-content/70 break-words'>
                            {Object.keys(log.metadata || {}).length
                              ? JSON.stringify(log.metadata)
                              : i18n.t('settings.audit.unavailable')}
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
