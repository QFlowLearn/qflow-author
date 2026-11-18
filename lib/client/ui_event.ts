/** Report unexpected UI failures through the browser's uncaught-error channel. */
export function reportUiError(cause: unknown): void {
  queueMicrotask(() => {
    throw cause;
  });
}

/**
 * Adapt a promise-returning action to a synchronous UI callback.
 * The feature owns request cancellation and expected failures; this boundary reports defects.
 * @template Args The callback's original arguments.
 */
export function uiEvent<Args extends unknown[]>(
  action: (...args: Args) => Promise<unknown> | void,
): (...args: Args) => void {
  return (...args) => {
    const result = action(...args);
    if (result) result.catch(reportUiError);
  };
}
