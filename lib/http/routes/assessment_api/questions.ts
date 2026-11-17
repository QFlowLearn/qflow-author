import { defineHttpRoute, type HttpRequest } from '../../route.ts';
import { saveAssessmentQuestion } from '../../../services/assessment_question_authoring.ts';
import { parseAssessmentQuestionCommand } from '../../../assessment_question_command.ts';
import { requireAuthContext } from '../../../tenants.ts';

export const questionsApiRoute = defineHttpRoute('/api/assessments/:id/questions', {
  'POST': handle,
});

async function handle(ctx: HttpRequest) {
  const input = parseAssessmentQuestionCommand(await ctx.req.json().catch(() => null));
  if (!input.ok) {
    return Response.json({ error: 'invalid_request', message: input.message, issues: [] }, {
      status: 400,
    });
  }
  const result = await saveAssessmentQuestion(
    requireAuthContext(ctx.state),
    ctx.params.id,
    input.command,
  );
  return result.ok
    ? Response.json(result.value, { status: result.status })
    : Response.json(result.error, { status: result.status });
}
