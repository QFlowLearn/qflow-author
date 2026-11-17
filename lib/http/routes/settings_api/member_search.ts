import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { searchMembers } from '../../../services/memberships.ts';
import { requireAuthContext } from '../../../tenants.ts';

const methods = {
  async GET(ctx: HttpRequest) {
    const query = parseMemberSearchQuery(ctx.url.searchParams);
    if (!query.ok) {
      return Response.json(
        { error: 'invalid_query', message: query.message },
        { status: 400 },
      );
    }
    const auth = requireAuthContext(ctx.state);
    const members = await searchMembers(auth.tenantId, query.value);
    return Response.json({
      members: members.map((member) => ({
        userId: member.userId,
        email: member.email,
        displayName: member.displayName ?? null,
        label: member.displayName?.trim() || member.email,
      })),
    });
  },
};

type MemberSearchQuery =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string };

function parseMemberSearchQuery(searchParams: URLSearchParams): MemberSearchQuery {
  if ([...searchParams.keys()].some((key) => key !== 'q')) {
    return { ok: false, message: 'Member search contains an unknown option.' };
  }
  const values = searchParams.getAll('q');
  if (values.length !== 1) {
    return { ok: false, message: 'Enter one member search.' };
  }
  const value = values[0].trim();
  if (value.length < 2 || value.length > 200) {
    return { ok: false, message: 'Enter 2 to 200 characters.' };
  }
  return { ok: true, value };
}

export const memberSearchRoute = defineHttpRoute('/api/members/search', {
  GET: methods.GET,
  HEAD: methods.GET,
});
