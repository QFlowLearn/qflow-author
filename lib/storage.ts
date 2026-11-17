import { getEnv, requireEnv } from './config.ts';
import {
  getRuntimeBinding,
  getRuntimeState,
  getRuntimeStringBinding,
  normalizeRuntime,
  type QflowRuntime,
  type RuntimeSource,
} from './runtime.ts';
import { createR2BindingStorage, type R2BucketLike } from './storage/r2_binding_storage.ts';
import { createS3CompatibleStorage } from './storage/s3_compatible_storage.ts';
import type { ObjectStorage } from './storage_contract.ts';

type StorageBackend = 'r2-binding' | 's3-compatible';
type RuntimeWithStorageBinding = QflowRuntime;

/** Resolves and caches the explicitly configured object-storage backend. */
export function resolveStorage(runtime?: RuntimeSource): ObjectStorage {
  const target = normalizeRuntime(runtime);
  const state = getRuntimeState(target);
  if (state?.storage) return state.storage;

  const storage = createStorageFromRuntime(target);
  if (state) state.storage = storage;
  return storage;
}

function createStorageFromRuntime(runtime: RuntimeWithStorageBinding): ObjectStorage {
  const backend = readConfiguredBackend(runtime);
  if (backend === 'r2-binding') {
    const bucket = findUploadBucketBinding(runtime);
    if (!bucket) {
      throw new Error('QFLOW_STORAGE_BACKEND=r2-binding requires the QFLOW_UPLOADS R2 binding.');
    }
    return createR2BindingStorage(bucket);
  }
  return createS3CompatibleStorage(readS3CompatibleConfig(runtime));
}

function findUploadBucketBinding(runtime: RuntimeWithStorageBinding): R2BucketLike | null {
  const candidate = getRuntimeBinding(runtime, 'QFLOW_UPLOADS');
  return isR2BucketLike(candidate) ? candidate : null;
}

function isR2BucketLike(value: unknown): value is R2BucketLike {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { put?: unknown }).put === 'function' &&
      typeof (value as { get?: unknown }).get === 'function' &&
      typeof (value as { delete?: unknown }).delete === 'function',
  );
}

function readConfiguredBackend(runtime: RuntimeWithStorageBinding): StorageBackend {
  const raw = getRuntimeStringBinding(runtime, 'QFLOW_STORAGE_BACKEND') ??
    getEnv('QFLOW_STORAGE_BACKEND');
  if (raw === 'r2-binding' || raw === 's3-compatible') return raw;
  if (!raw) {
    throw new Error(
      'Missing required env var QFLOW_STORAGE_BACKEND. Expected "r2-binding" or "s3-compatible".',
    );
  }
  throw new Error(
    `Invalid QFLOW_STORAGE_BACKEND "${raw}". Expected "r2-binding" or "s3-compatible".`,
  );
}

function readS3CompatibleConfig(runtime: RuntimeWithStorageBinding) {
  return {
    endpoint: requireRuntimeEnv(runtime, 'R2_ENDPOINT'),
    accessKeyId: requireRuntimeEnv(runtime, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: requireRuntimeEnv(runtime, 'R2_SECRET_ACCESS_KEY'),
    bucket: requireRuntimeEnv(runtime, 'R2_BUCKET'),
    forcePathStyle: parseOptionalBoolean(
      getRuntimeStringBinding(runtime, 'R2_FORCE_PATH_STYLE'),
      'R2_FORCE_PATH_STYLE',
      true,
    ),
  };
}

function requireRuntimeEnv(runtime: RuntimeWithStorageBinding, key: string): string {
  return getRuntimeStringBinding(runtime, key) ?? requireEnv(key);
}

function parseOptionalBoolean(
  input: string | undefined,
  key: string,
  defaultValue: boolean,
): boolean {
  if (input === undefined || input.trim() === '') return defaultValue;
  const value = input.trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  throw new Error(`Invalid ${key} "${input}". Expected a boolean value.`);
}
