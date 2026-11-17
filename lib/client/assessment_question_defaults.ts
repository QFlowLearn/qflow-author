import {
  type AssessmentQuestionPointDefault,
  type AssessmentQuestionPointDefaultCommand,
  parseAssessmentQuestionPointDefaultResponse,
} from '../assessment_question_defaults.ts';

/** Network uncertainty retains the exact command; definite rejections never claim persistence. */
export type AssessmentPointDefaultSaveOutcome =
  | { readonly _tag: 'Saved'; readonly value: AssessmentQuestionPointDefault }
  | { readonly _tag: 'Conflict' | 'Rejected' | 'Uncertain' | 'Cancelled' };

/** Save only one captured policy with a caller-owned lifetime and exact acknowledgement. */
export async function saveAssessmentPointDefault(
  assessmentId: string,
  command: AssessmentQuestionPointDefaultCommand,
  signal: AbortSignal,
): Promise<AssessmentPointDefaultSaveOutcome> {
  try {
    const response = await fetch(`/api/assessments/${assessmentId}/question-defaults`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
      signal,
    });
    if (response.status === 409) return { _tag: 'Conflict' };
    if (!response.ok) return { _tag: response.status >= 500 ? 'Uncertain' : 'Rejected' };
    const body: unknown = await response.json();
    const parsed = parseAssessmentQuestionPointDefaultResponse(body, 'Saved');
    return parsed._tag === 'Parsed' && parsed.value === command.desired
      ? { _tag: 'Saved', value: parsed.value }
      : { _tag: 'Uncertain' };
  } catch (_cause: unknown) {
    return { _tag: signal.aborted ? 'Cancelled' : 'Uncertain' };
  }
}

/** Explicit conflict refresh changes the confirmed baseline while retaining the author's text. */
export async function readAssessmentPointDefault(
  assessmentId: string,
  signal: AbortSignal,
): Promise<
  { readonly _tag: 'Found'; readonly value: AssessmentQuestionPointDefault } | {
    readonly _tag: 'Unavailable';
  }
> {
  try {
    const response = await fetch(`/api/assessments/${assessmentId}/question-defaults`, {
      signal,
      cache: 'no-store',
    });
    if (!response.ok) return { _tag: 'Unavailable' };
    const body: unknown = await response.json();
    const parsed = parseAssessmentQuestionPointDefaultResponse(body, 'Found');
    return parsed._tag === 'Parsed'
      ? { _tag: 'Found', value: parsed.value }
      : { _tag: 'Unavailable' };
  } catch (_cause: unknown) {
    return { _tag: 'Unavailable' };
  }
}
