/** Refined input or a controlled assessment HTTP client error. */
export type AssessmentRequestResult<T> =
  | { readonly _tag: 'Parsed'; readonly value: T }
  | { readonly _tag: 'Invalid'; readonly message: string };

/** Parse a bounded integer list limit; omission preserves quick-switch defaults. */
export function parseAssessmentListLimit(value: string | null): AssessmentRequestResult<number> {
  if (value === null) return { _tag: 'Parsed', value: 6 };
  if (!/^\d+$/.test(value)) {
    return { _tag: 'Invalid', message: 'Limit must be an integer from 1 to 20.' };
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    return { _tag: 'Invalid', message: 'Limit must be an integer from 1 to 20.' };
  }
  return { _tag: 'Parsed', value: limit };
}

/** Decode the supported draft creation object before any persistence operation. */
export async function parseAssessmentCreateRequest(
  request: Request,
): Promise<AssessmentRequestResult<{ readonly title?: string }>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { _tag: 'Invalid', message: 'Request body must be valid JSON.' };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { _tag: 'Invalid', message: 'Request body must be an object.' };
  }
  if (Object.keys(body).some((key) => key !== 'title')) {
    return { _tag: 'Invalid', message: 'Only title may be supplied.' };
  }
  if (!('title' in body)) return { _tag: 'Parsed', value: {} };
  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    return { _tag: 'Invalid', message: 'Title must be a nonempty string.' };
  }
  return { _tag: 'Parsed', value: { title: body.title.trim() } };
}
