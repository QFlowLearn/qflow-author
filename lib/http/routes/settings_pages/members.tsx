import { mountIsland } from '../../../rendering/mount_island.ts';
import LocalizedTimestampView from '../../../../islands/LocalizedTimestamp.tsx';
import PublicationGrantControl from '../../../../components/settings/PublicationGrantControl.tsx';
import { hasWorkspaceCapability } from '../../../services/workspace_authorization.ts';
import Button from '../../../../components/ui/Button.tsx';
import Input from '../../../../components/ui/Input.tsx';
import Select from '../../../../components/ui/Select.tsx';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { createTenantUser } from '../../../services/auth.ts';
import { recordAuditEvent } from '../../../services/audit_logs.ts';
import { isValidEmail, normalizeEmail } from '../../../services/email_address.ts';
import {
  listMembers,
  type MemberRecord,
  removeMember,
  updateMemberRole,
} from '../../../services/memberships.ts';
import { parseRole, type Role } from '../../../roles.ts';
import { requireAuthContext } from '../../../tenants.ts';
import type { I18n } from '../../../i18n/messages.ts';

type MembersErrorCode =
  | 'invalid_email'
  | 'exists'
  | 'create_failed'
  | 'missing_id'
  | 'last_owner'
  | 'update_failed'
  | 'self_remove'
  | 'remove_failed'
  | 'unknown_action'
  | 'forbidden';
type MembersSuccessCode = 'created' | 'role_updated' | 'removed' | 'publication_updated';
const ERROR_MESSAGE_IDS: Record<MembersErrorCode, string> = {
  invalid_email: 'settings.members.error.invalidEmail',
  exists: 'settings.members.error.exists',
  create_failed: 'settings.members.error.createFailed',
  missing_id: 'settings.members.error.missingId',
  last_owner: 'settings.members.error.lastOwner',
  update_failed: 'settings.members.error.updateFailed',
  self_remove: 'settings.members.error.selfRemove',
  remove_failed: 'settings.members.error.removeFailed',
  unknown_action: 'settings.members.error.unknownAction',
  forbidden: 'settings.members.error.forbidden',
};
const SUCCESS_MESSAGE_IDS: Record<MembersSuccessCode, string> = {
  publication_updated: 'settings.members.success.publicationUpdated',
  created: 'settings.members.success.created',
  role_updated: 'settings.members.success.roleUpdated',
  removed: 'settings.members.success.removed',
};

type Data = {
  members: MemberRecord[];
  selfUserId: string;
  error?: MembersErrorCode | null;
  success?: MembersSuccessCode | null;
  credentials?: { readonly email: string; readonly password: string } | null;
};

const ROLE_OPTIONS = [
  { value: 'owner', messageId: 'settings.members.owner' },
  { value: 'member', messageId: 'settings.members.memberRole' },
] as const;

function normalizeMemberRole(value: string): Role {
  const parsed = parseRole(value);
  return parsed === 'owner' ? 'owner' : 'instructor';
}

function formatDate(value: string | null | undefined, i18n: I18n) {
  if (!value) return i18n.t('settings.members.unavailable');
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return i18n.t('settings.members.unavailable');
    return <LocalizedTimestamp value={date.toISOString()} locale={i18n.locale} showTime={false} />;
  } catch (_err) {
    return i18n.t('settings.members.unavailable');
  }
}

const methods = {
  async GET(ctx) {
    const auth = requireAuthContext(ctx.state);
    if (!await hasWorkspaceCapability(auth, 'manage_members')) {
      return new Response(ctx.state.i18n.t(ERROR_MESSAGE_IDS.forbidden), { status: 403 });
    }

    const members = await listMembers(auth.tenantId);
    return ctx.render(
      <MembersPage
        i18n={ctx.state.i18n}
        data={{
          members,
          selfUserId: auth.userId,
          success: ctx.url.searchParams.get('publication') === 'updated'
            ? 'publication_updated'
            : null,
        }}
      />,
    );
  },
  async POST(ctx) {
    const auth = requireAuthContext(ctx.state);
    if (!await hasWorkspaceCapability(auth, 'manage_members')) {
      return new Response(ctx.state.i18n.t(ERROR_MESSAGE_IDS.forbidden), { status: 403 });
    }

    const form = await ctx.req.formData();
    const action = String(form.get('action') ?? '').trim();
    const members = await listMembers(auth.tenantId);

    if (action === 'create') {
      const email = String(form.get('email') ?? '').trim();
      const roleInput = String(form.get('role') ?? 'member');
      if (!email || !isValidEmail(normalizeEmail(email))) {
        return ctx.render(
          <MembersPage
            i18n={ctx.state.i18n}
            data={{ members, selfUserId: auth.userId, error: 'invalid_email' }}
          />,
        );
      }

      const result = await createTenantUser({
        tenantId: auth.tenantId,
        email,
        role: normalizeMemberRole(roleInput),
      });
      if (!result.ok) {
        const error: MembersErrorCode = result.code === 'exists'
          ? 'exists'
          : result.code === 'invalid_email'
          ? 'invalid_email'
          : 'create_failed';
        return ctx.render(
          <MembersPage i18n={ctx.state.i18n} data={{ members, selfUserId: auth.userId, error }} />,
        );
      }
      const nextMembers = await listMembers(auth.tenantId);
      await recordAuditEvent({
        tenantId: auth.tenantId,
        action: 'member_created',
        actorUserId: auth.userId,
        targetUserId: result.userId,
        ipAddress: ctx.clientIp,
        userAgent: ctx.req.headers.get('user-agent'),
        metadata: { email },
      });
      return ctx.render(
        <MembersPage
          i18n={ctx.state.i18n}
          data={{
            members: nextMembers,
            selfUserId: auth.userId,
            success: 'created',
            credentials: { email, password: result.tempPassword },
          }}
        />,
      );
    }

    if (action === 'update-role') {
      const userId = String(form.get('userId') ?? '').trim();
      const roleInput = String(form.get('role') ?? 'member');
      if (!userId) {
        return ctx.render(
          <MembersPage
            i18n={ctx.state.i18n}
            data={{ members, selfUserId: auth.userId, error: 'missing_id' }}
          />,
        );
      }
      const update = await updateMemberRole({
        actor: auth,
        tenantId: auth.tenantId,
        userId,
        role: normalizeMemberRole(roleInput),
      });
      if (!update.ok) {
        const error: MembersErrorCode = update.code === 'last_owner'
          ? 'last_owner'
          : 'update_failed';
        return ctx.render(
          <MembersPage i18n={ctx.state.i18n} data={{ members, selfUserId: auth.userId, error }} />,
        );
      }
      const nextMembers = await listMembers(auth.tenantId);
      return ctx.render(
        <MembersPage
          i18n={ctx.state.i18n}
          data={{ members: nextMembers, selfUserId: auth.userId, success: 'role_updated' }}
        />,
      );
    }

    if (action === 'remove') {
      const userId = String(form.get('userId') ?? '').trim();
      if (!userId) {
        return ctx.render(
          <MembersPage
            i18n={ctx.state.i18n}
            data={{ members, selfUserId: auth.userId, error: 'missing_id' }}
          />,
        );
      }
      if (userId === auth.userId) {
        return ctx.render(
          <MembersPage
            i18n={ctx.state.i18n}
            data={{
              members,
              selfUserId: auth.userId,
              error: 'self_remove',
            }}
          />,
        );
      }
      const removed = await removeMember({ actor: auth, tenantId: auth.tenantId, userId });
      if (!removed.ok) {
        const error: MembersErrorCode = removed.code === 'last_owner'
          ? 'last_owner'
          : 'remove_failed';
        return ctx.render(
          <MembersPage i18n={ctx.state.i18n} data={{ members, selfUserId: auth.userId, error }} />,
        );
      }
      const nextMembers = await listMembers(auth.tenantId);
      return ctx.render(
        <MembersPage
          i18n={ctx.state.i18n}
          data={{ members: nextMembers, selfUserId: auth.userId, success: 'removed' }}
        />,
      );
    }

    return ctx.render(
      <MembersPage
        i18n={ctx.state.i18n}
        data={{ members, selfUserId: auth.userId, error: 'unknown_action' }}
      />,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const settingsMembersPageRoute = defineHttpRoute('/settings/members', {
  ...methods,
  HEAD: methods.GET,
});

export default function MembersPage({ data, i18n }: { data: Data; i18n: I18n }) {
  return (
    <section class='space-y-6'>
      <div class='space-y-2'>
        <h1 class='text-3xl font-medium'>{i18n.t('settings.members.title')}</h1>
        <p class='text-sm text-base-content/70'>{i18n.t('settings.members.subtitle')}</p>
      </div>

      {data.error && (
        <div class='ds-alert ds-alert-error text-sm' role='alert'>
          {i18n.t(ERROR_MESSAGE_IDS[data.error])}
        </div>
      )}
      {data.success && (
        <div class='ds-alert text-sm' role='status'>
          {i18n.t(SUCCESS_MESSAGE_IDS[data.success])}
        </div>
      )}
      {data.credentials && (
        <div class='ds-alert ds-alert-warning text-sm space-y-2' role='status'>
          <div class='font-medium'>
            {i18n.t('settings.members.tempPasswordTitle', { email: data.credentials.email })}
          </div>
          <div>
            {i18n.t('settings.members.tempPasswordHelp')}
          </div>
          <div class='font-mono bg-base-200 rounded px-3 py-2 inline-block'>
            {data.credentials.password}
          </div>
        </div>
      )}

      <form method='post' class='ds-card ds-card-bordered'>
        <div class='ds-card-body space-y-4'>
          <h2 class='text-lg font-medium'>{i18n.t('settings.members.addMember')}</h2>
          <input type='hidden' name='action' value='create' />
          <label class='ds-form-control'>
            <span>{i18n.t('settings.members.email')}</span>
            <Input name='email' type='email' autoComplete='email' required />
          </label>
          <label class='ds-form-control'>
            <span>{i18n.t('settings.members.role')}</span>
            <Select name='role' size='sm' defaultValue='member'>
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{i18n.t(opt.messageId)}</option>
              ))}
            </Select>
          </label>
        </div>
        <div class='ds-card-actions justify-between border-t border-base-200 px-6 py-4'>
          <Button variant='primary' type='submit'>{i18n.t('settings.members.createUser')}</Button>
          <div class='text-xs text-base-content/60'>
            {i18n.t('settings.members.firstSignIn')}
          </div>
        </div>
      </form>

      <div class='ds-card ds-card-bordered'>
        <div class='ds-card-body space-y-4'>
          <h2 class='text-lg font-medium'>{i18n.t('settings.members.currentMembers')}</h2>
          {data.members.length === 0 && (
            <p class='text-sm text-base-content/60'>{i18n.t('settings.members.empty')}</p>
          )}
          <div class='overflow-x-auto'>
            <table class='ds-table w-full text-sm'>
              <thead>
                <tr>
                  <th>{i18n.t('settings.members.member')}</th>
                  <th>{i18n.t('settings.members.role')}</th>
                  <th>{i18n.t('settings.members.canPublishEditions')}</th>
                  <th>{i18n.t('settings.members.joined')}</th>
                  <th class='text-right'>{i18n.t('settings.members.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((member) => (
                  <tr key={member.userId}>
                    <td>
                      <div class='font-medium'>
                        {member.displayName || member.email}
                      </div>
                      {member.displayName && (
                        <div class='text-xs text-base-content/60'>{member.email}</div>
                      )}
                    </td>
                    <td>
                      <form method='post' class='flex items-center gap-2'>
                        <input type='hidden' name='action' value='update-role' />
                        <input type='hidden' name='userId' value={member.userId} />
                        <Select
                          name='role'
                          size='sm'
                          defaultValue={member.role === 'owner' ? 'owner' : 'member'}
                        >
                          {ROLE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {i18n.t(opt.messageId)}
                            </option>
                          ))}
                        </Select>
                        <Button type='submit' size='sm'>{i18n.t('settings.members.save')}</Button>
                      </form>
                    </td>
                    <td>
                      <PublicationGrantControl member={member} i18n={i18n} />
                    </td>
                    <td>{formatDate(member.joinedAt, i18n)}</td>
                    <td class='text-right'>
                      <form method='post'>
                        <input type='hidden' name='action' value='remove' />
                        <input type='hidden' name='userId' value={member.userId} />
                        <Button
                          type='submit'
                          variant='ghost'
                          size='sm'
                          class='text-error'
                          disabled={member.userId === data.selfUserId}
                        >
                          {member.userId === data.selfUserId
                            ? i18n.t('settings.members.you')
                            : i18n.t('settings.members.remove')}
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

const LocalizedTimestamp = mountIsland({
  component: 'LocalizedTimestamp',
  View: LocalizedTimestampView,
});
