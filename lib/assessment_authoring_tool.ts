/** Stable identifiers shared by assessment tool URLs, disclosure state, and controlled panels. */
export const ASSESSMENT_TOOL_IDS = {
  plan: 'assessment-plan',
  export: 'assessment-export',
} as const;

/** A secondary tool that can be opened alongside the assessment authoring canvas. */
export type AssessmentTool = typeof ASSESSMENT_TOOL_IDS[keyof typeof ASSESSMENT_TOOL_IDS];

/** The result of parsing an assessment authoring URL. */
export type AssessmentToolQueryResult =
  | { readonly ok: true; readonly tool: AssessmentTool | null }
  | { readonly ok: false; readonly message: string };

/** Parses one optional assessment tool from the authoring page query. */
export function parseAssessmentToolQuery(
  searchParams: URLSearchParams,
): AssessmentToolQueryResult {
  for (const key of searchParams.keys()) {
    if (key !== 'tool') {
      return { ok: false, message: 'The assessment editor contains an unsupported option.' };
    }
  }

  const values = searchParams.getAll('tool');
  if (values.length > 1) {
    return { ok: false, message: 'Choose only one assessment editor tool.' };
  }
  if (values.length === 0) return { ok: true, tool: null };

  const tool = values[0];
  if (tool === ASSESSMENT_TOOL_IDS.plan || tool === ASSESSMENT_TOOL_IDS.export) {
    return { ok: true, tool };
  }
  return { ok: false, message: `QFlowLearn does not support the "${tool}" assessment tool.` };
}

/** Builds the canonical assessment authoring URL for an optional secondary tool. */
export function assessmentToolHref(
  assessmentId: string,
  tool: AssessmentTool | null,
): string {
  const encodedAssessmentId = encodeURIComponent(assessmentId);
  if (tool === null) return `/assessments/${encodedAssessmentId}`;
  return `/assessments/${encodedAssessmentId}?tool=${tool}`;
}
