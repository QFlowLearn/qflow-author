import Button from '../../../../components/ui/Button.tsx';
import { defineHttpRoute, type HttpHandler } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import {
  parsePublicationGrantForm,
  setPublicationGrant,
} from '../../../services/publication_grants.ts';
import { hasWorkspaceCapability } from '../../../services/workspace_authorization.ts';

const FAILURES = {
  forbidden: { status: 403, message: 'settings.members.error.forbidden' },
  invalid_input: { status: 400, message: 'settings.members.error.invalidGrantInput' },
  invalid_member: { status: 400, message: 'settings.members.error.invalidGrantMember' },
  not_member: { status: 404, message: 'settings.members.error.grantMemberMissing' },
} as const;

const methods = {
  async POST(ctx) {
    const auth = requireAuthContext(ctx.state);
    if (!await hasWorkspaceCapability(auth, 'manage_members')) {
      return new Response(ctx.state.i18n.t(FAILURES.forbidden.message), { status: 403 });
    }
    const input = parsePublicationGrantForm(await ctx.req.formData());
    const result = input.ok ? await setPublicationGrant(auth, input.userId, input.action) : input;
    if (result.ok) {
      return new Response(null, {
        status: 303,
        headers: { location: '/settings/members?publication=updated' },
      });
    }
    const failure = FAILURES[result.code];
    return ctx.render(
      <section class='space-y-4'>
        <p role='alert'>{ctx.state.i18n.t(failure.message)}</p>
        <Button href='/settings/members'>{ctx.state.i18n.t('settings.members.title')}</Button>
      </section>,
      failure.status,
    );
  },
} satisfies Readonly<Record<string, HttpHandler>>;
export const settingsPublicationGrantsPageRoute = defineHttpRoute('/settings/publication-grants', {
  ...methods,
});
