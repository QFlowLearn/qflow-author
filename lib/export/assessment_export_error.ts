/** Expected export failure surfaced to API callers instead of masking as a generic 422. */
export class AssessmentExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssessmentExportError';
  }
}
