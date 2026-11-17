/** Classify filesystem failures through Node's stable error codes without exposing paths/messages. */
export function hasFileErrorCode(value: unknown, code: string): boolean {
  return typeof value === 'object' && value !== null && 'code' in value && value.code === code;
}
