/** Return a stable error classification without serializing messages or thrown values. */
export function safeErrorSummary(cause: unknown): string {
  if (cause instanceof Error) return cause.name || 'Error';
  return typeof cause;
}
