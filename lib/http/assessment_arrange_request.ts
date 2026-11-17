import {
  type AssessmentArrangeRequestParseResult,
  parseAssessmentArrangeRequest,
} from '../assessment_arrangement.ts';

/** Decode an arrangement body and pass it through the canonical structure parser. */
export async function parseAssessmentArrangeHttpRequest(
  request: Request,
): Promise<AssessmentArrangeRequestParseResult> {
  let value: unknown;
  try {
    value = await request.json();
  } catch (_cause: unknown) {
    return {
      ok: false,
      error: {
        _tag: 'InvalidAssessmentArrangeRequest',
        message: 'Request body must be valid JSON.',
      },
    };
  }
  return parseAssessmentArrangeRequest(value);
}
