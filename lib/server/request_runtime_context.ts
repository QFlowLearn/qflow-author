import { AsyncLocalStorage } from 'node:async_hooks';

import type { QflowRequestRuntimeContext, QflowRuntime } from '../runtime.ts';

const REQUEST_RUNTIME_STORAGE_KEY = Symbol.for('qflow.requestRuntimeStorage');

type RuntimeGlobal = typeof globalThis & {
  [REQUEST_RUNTIME_STORAGE_KEY]?: AsyncLocalStorage<QflowRequestRuntimeContext>;
};

/** Run one request inside an isolated runtime context shared by every server bundle. */
export function runWithRequestRuntime<T>(
  runtime: QflowRuntime,
  operation: () => T,
): T {
  return requestRuntimeStorage().run({ runtime }, operation);
}

function requestRuntimeStorage(): AsyncLocalStorage<QflowRequestRuntimeContext> {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  const current = runtimeGlobal[REQUEST_RUNTIME_STORAGE_KEY];
  if (current) return current;
  const created = new AsyncLocalStorage<QflowRequestRuntimeContext>();
  runtimeGlobal[REQUEST_RUNTIME_STORAGE_KEY] = created;
  return created;
}
