import { parseQtiXml, type QtiValue } from '@longsightgroup/qti3-core';
import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { requireAuthContext } from '../../../tenants.ts';
import { isCanonicalUuid } from '../../../uuid.ts';
import { getQuestionRevision } from '../../../services/questions.ts';
import { hasWorkspaceCapability } from '../../../services/workspace_authorization.ts';
import type { BankQuestionPreview } from '../../../bank_question_preview.ts';

export const itemPreviewApiRoute = defineHttpRoute('/api/items/:id/preview', {
  GET: handleGET,
  HEAD: handleGET,
});

async function handleGET(ctx: HttpRequest) {
  const revision = Number(ctx.url.searchParams.get('revision'));
  if (
    !isCanonicalUuid(ctx.params.id) || !Number.isSafeInteger(revision) || revision < 1 ||
    ctx.url.searchParams.getAll('revision').length !== 1
  ) return new Response(null, { status: 400 });
  const auth = requireAuthContext(ctx.state);
  if (!await hasWorkspaceCapability(auth, 'view_content')) {
    return new Response(null, { status: 403 });
  }
  const source = await getQuestionRevision(auth, ctx.params.id, revision);
  if (!source) return new Response(null, { status: 404 });
  const parsed = parseQtiXml(source.qtiXml);
  if (!parsed.document) return new Response(null, { status: 422 });
  const item = parsed.document.item;
  const answers = item.responseDeclarations.flatMap((response) => {
    if (response.correctResponse === null) return [];
    const interaction = item.interactions.find((entry) =>
      entry.responseIdentifier === response.identifier
    );
    const label = (value: QtiValue): string => {
      if (Array.isArray(value)) return value.map(label).join('; ');
      if (value !== null && typeof value === 'object') {
        return Object.entries(value).map(([key, field]) => `${key}: ${label(field)}`).join('; ');
      }
      const choice = interaction?.choices.find((choice) => choice.identifier === value);
      return choice?.text.trim() || String(value);
    };
    return [label(response.correctResponse)];
  });
  return Response.json(
    {
      itemId: ctx.params.id,
      revision,
      title: item.title ?? '',
      xml: source.qtiXml,
      answers,
    } satisfies BankQuestionPreview,
  );
}
