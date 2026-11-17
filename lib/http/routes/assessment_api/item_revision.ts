import { questionPointEditingAuthority } from '../../../services/question_points_editing.ts';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { getQuestionRevision } from '../../../services/questions.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const itemRevisionApiRoute = defineHttpRoute('/api/items/:id/revisions/:rev', {
  '*': handle,
});

async function handle(ctx: HttpRequest) {
  const revisionNumber = Number(ctx.params.rev);
  if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
    return new Response('Invalid revision', { status: 400 });
  }
  const revision = await getQuestionRevision(
    requireAuthContext(ctx.state),
    ctx.params.id,
    revisionNumber,
  );
  if (!revision) return new Response('Not Found', { status: 404 });
  return Response.json({
    id: ctx.params.id,
    latestRev: revision.revision,
    draft: revision.body,
    pointEditingAuthority: questionPointEditingAuthority({
      contentBasis: revision.provenance.event.contentBasis,
      sourceXml: revision.qtiXml,
    }),
  });
}
