/** Options for awaiting work under a caller-owned cancellation lifetime. */
export type CancellableOptions = {
  readonly signal?: AbortSignal;
};

/**
 * Stop awaiting an operation that cannot accept AbortSignal while continuing to observe its result.
 *
 * Use this only when the underlying dependency has no cancellation API and cannot perform unfenced
 * application mutations after the caller stops waiting.
 */
export async function awaitWithAbortSignal<T>(
  operation: Promise<T>,
  options: CancellableOptions = {},
): Promise<T> {
  const signal = options.signal;
  if (!signal) return await operation;

  const observed = operation.then(
    (value) => ({ _tag: 'Resolved' as const, value }),
    (cause: unknown) => ({ _tag: 'Rejected' as const, cause }),
  );
  if (signal.aborted) {
    throw signal.reason ?? new DOMException('Operation aborted.', 'AbortError');
  }

  let stop: (() => void) | undefined;
  const aborted = new Promise<{ readonly _tag: 'Aborted' }>((resolve) => {
    stop = () => resolve({ _tag: 'Aborted' });
    signal.addEventListener('abort', stop, { once: true });
  });
  try {
    const outcome = await Promise.race([observed, aborted]);
    if (outcome._tag === 'Resolved') return outcome.value;
    if (outcome._tag === 'Rejected') throw outcome.cause;
    throw signal.reason ?? new DOMException('Operation aborted.', 'AbortError');
  } finally {
    if (stop) signal.removeEventListener('abort', stop);
  }
}

/** Sleep for a fixed delay while honoring caller-owned cancellation. */
export async function sleepWithSignal(
  delayMs: number,
  options: CancellableOptions = {},
): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error('Sleep delay must be a non-negative finite number.');
  }
  await new Promise<void>((resolve, reject) => {
    const finish = (outcome: 'elapsed' | 'aborted') => {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', stop);
      if (outcome === 'elapsed') {
        resolve();
        return;
      }
      reject(
        options.signal?.reason instanceof Error
          ? options.signal?.reason
          : new DOMException('Sleep aborted.', 'AbortError'),
      );
    };
    const stop = () => finish('aborted');
    const timeoutId = setTimeout(() => finish('elapsed'), delayMs);
    if (options.signal?.aborted) {
      stop();
      return;
    }
    options.signal?.addEventListener('abort', stop, { once: true });
  });
}
