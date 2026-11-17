import type { QflowDatabase } from './db.ts';
import type { ObjectStorage } from './storage_contract.ts';

/** Runtime bindings supplied by the active composition root. */
export type QflowRuntimeBindings = Record<string, unknown>;

/** Mutable state owned by one HTTP request. */
export type QflowRuntimeState = {
  runtime?: QflowRuntime;
  storage?: ObjectStorage;
};

/** Canonical runtime capabilities available to application code. */
export type QflowRuntime = {
  state?: QflowRuntimeState;
  bindings?: QflowRuntimeBindings;
};

/** Request, workflow, or test source that can resolve to the canonical runtime. */
export type RuntimeSource = QflowRuntime | QflowRuntimeState | undefined;

/** One request's canonical runtime and lazily owned database capability. */
export type QflowRequestRuntimeContext = {
  readonly runtime: QflowRuntime;
  database?: {
    readonly hyperdriveBinding: object;
    readonly value: QflowDatabase;
  };
};

const REQUEST_RUNTIME_STORAGE_KEY = Symbol.for('qflow.requestRuntimeStorage');

type RuntimeGlobal = typeof globalThis & {
  [REQUEST_RUNTIME_STORAGE_KEY]?: {
    getStore(): QflowRequestRuntimeContext | undefined;
  };
};

/** Resolves the canonical runtime from a runtime, request state, or active request scope. */
export function normalizeRuntime(runtime?: RuntimeSource): QflowRuntime {
  if (runtime === undefined) return requestRuntimeStore() ?? {};
  if (isRuntimeState(runtime)) return runtime.runtime ?? requestRuntimeStore() ?? {};

  const nested = runtime.state?.runtime;
  return {
    state: runtime.state ?? nested?.state,
    bindings: runtime.bindings ?? nested?.bindings ?? requestRuntimeStore()?.bindings,
  };
}

/** Installs the active canonical runtime on HTTP request state. */
export function installRuntime(runtime: QflowRuntime): QflowRuntime {
  const resolved = normalizeRuntime(runtime);
  const state = runtime.state;
  const installed: QflowRuntime = {
    bindings: resolved.bindings,
    state,
  };
  if (state) state.runtime = installed;
  return installed;
}

/** Returns mutable HTTP request state from a supported runtime context. */
export function getRuntimeState(runtime?: RuntimeSource): QflowRuntimeState | undefined {
  return normalizeRuntime(runtime).state;
}

/** Returns one named binding from the canonical runtime. */
export function getRuntimeBinding(runtime: RuntimeSource, key: string): unknown {
  return normalizeRuntime(runtime).bindings?.[key];
}

/** Returns one string-valued binding from the canonical runtime. */
export function getRuntimeStringBinding(runtime: RuntimeSource, key: string): string | undefined {
  const value = getRuntimeBinding(runtime, key);
  return typeof value === 'string' ? value : undefined;
}

/** Resolve the database owned by this request's immutable Hyperdrive binding. */
export function resolveRequestDatabase(
  hyperdriveBinding: object,
  create: () => QflowDatabase,
): QflowDatabase {
  const context = requestRuntimeContext();
  if (!context) return create();

  const current = context.database;
  if (current) {
    if (current.hyperdriveBinding !== hyperdriveBinding) {
      throw new Error('Cloudflare Hyperdrive binding changed within one request.');
    }
    return current.value;
  }

  const value = create();
  context.database = { hyperdriveBinding, value };
  return value;
}

function isRuntimeState(source: QflowRuntime | QflowRuntimeState): source is QflowRuntimeState {
  return !('bindings' in source) && !('state' in source);
}

function requestRuntimeStore(): QflowRuntime | undefined {
  return requestRuntimeContext()?.runtime;
}

function requestRuntimeContext(): QflowRequestRuntimeContext | undefined {
  // SAFETY: the symbol-keyed slot is installed only by request_runtime_context.ts with this shape.
  const runtimeGlobal = globalThis as RuntimeGlobal;
  return runtimeGlobal[REQUEST_RUNTIME_STORAGE_KEY]?.getStore();
}
