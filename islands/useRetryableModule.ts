import { useCallback, useEffect, useState } from 'preact/hooks';

/** Observable lifecycle for one key-selected, asynchronously loaded module. */
export type RetryableModuleState<Key, Value> =
  | { readonly _tag: 'Loading'; readonly key: Key }
  | { readonly _tag: 'Ready'; readonly key: Key; readonly value: Value }
  | { readonly _tag: 'Failed'; readonly key: Key };

/** Loads one key-selected module and exposes a retry that preserves caller state. */
export function useRetryableModule<Key, Value>(
  key: Key,
  load: (key: Key) => Promise<Value>,
): {
  readonly state: RetryableModuleState<Key, Value>;
  readonly retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RetryableModuleState<Key, Value>>({
    _tag: 'Loading',
    key,
  });

  const retry = useCallback(() => {
    setState({ _tag: 'Loading', key });
    setAttempt((current) => current + 1);
  }, [key]);

  useEffect(() => {
    let active = true;
    setState({ _tag: 'Loading', key });
    Promise.resolve()
      .then(() => load(key))
      .then((value) => {
        if (active) setState({ _tag: 'Ready', key, value });
      })
      .catch((_cause: unknown) => {
        if (active) setState({ _tag: 'Failed', key });
      });

    return () => {
      active = false;
    };
  }, [attempt, key, load]);

  return {
    state: state.key === key ? state : { _tag: 'Loading', key },
    retry,
  };
}
