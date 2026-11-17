import {
  parsePrintConfiguration,
  type PrintConfiguration,
  type PrintPreflight,
} from '../print/print_contract.ts';
import type { PrintPackView } from '../print/print_view.ts';
import { parsePrintConfirmation } from '../print/print_confirmation.ts';
import { isCanonicalUuid } from '../uuid.ts';

/** Browser boundary with explicit parsing and no access to sealed source or object storage. */
export async function printRequest(
  path: string,
  input?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(path, {
    method: input === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: input === undefined ? undefined : { 'content-type': 'application/json' },
    body: input === undefined ? undefined : JSON.stringify(input),
    signal,
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const code = object(value)?.error;
    throw new Error(typeof code === 'string' && /^[a-z_]+$/.test(code) ? code : 'request_failed');
  }
  return value;
}
export const printBase = (id: string) => `/api/assessments/${encodeURIComponent(id)}/print-packs`;
export function parsePrintPackView(value: unknown): PrintPackView | null {
  const v = object(value);
  if (
    !v || typeof v.id !== 'string' || !isCanonicalUuid(v.id) || typeof v.form !== 'string' ||
    typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt)) ||
    !['preparing', 'queued', 'building', 'preview-ready', 'confirmed', 'failed'].includes(
      String(v.state),
    )
  ) return null;
  const configuration = parsePrintConfiguration(v.configuration);
  if (!configuration || typeof v.operationId !== 'string' || !isCanonicalUuid(v.operationId)) {
    return null;
  }
  const state = v.state;
  if (
    state !== 'preparing' && state !== 'queued' && state !== 'building' &&
    state !== 'preview-ready' && state !== 'confirmed' && state !== 'failed'
  ) return null;
  const confirmation = v.confirmation === null ? null : parsePrintConfirmation(v.confirmation);
  if ((state === 'preview-ready' || state === 'confirmed') && !confirmation) return null;
  if (
    !((v.studentPages === null || Number.isSafeInteger(v.studentPages)) &&
      (v.markingPages === null || Number.isSafeInteger(v.markingPages)))
  ) return null;
  return {
    configuration,
    operationId: v.operationId,
    id: v.id,
    form: v.form,
    state,
    createdAt: v.createdAt,
    confirmation,
    failureCode: typeof v.failureCode === 'string' ? v.failureCode : null,
    studentPages: typeof v.studentPages === 'number' ? v.studentPages : null,
    markingPages: typeof v.markingPages === 'number' ? v.markingPages : null,
  };
}
export function parsePrintPreflight(value: unknown): PrintPreflight | null {
  const v = object(value);
  if (
    !v || v.destinationId !== 'printable-pack' ||
    (v.outcome !== 'ready' && v.outcome !== 'blocked' && v.outcome !== 'needs-adaptation') ||
    !Array.isArray(v.items)
  ) return null;
  const items: PrintPreflight['items'][number][] = [];
  for (const raw of v.items) {
    const item = object(raw);
    if (
      !item || typeof item.placementId !== 'string' || typeof item.title !== 'string' ||
      (item.outcome !== 'Ready' && item.outcome !== 'Blocked' &&
        item.outcome !== 'NeedsAdaptation') ||
      !Array.isArray(item.codes) || !item.codes.every((code) => typeof code === 'string')
    ) return null;
    items.push({
      placementId: item.placementId,
      title: item.title,
      outcome: item.outcome,
      codes: item.codes,
      responseSpace: item.responseSpace === true,
    });
  }
  return { destinationId: 'printable-pack', outcome: v.outcome, items };
}
export async function requestPrintPreview(
  id: string,
  operationId: string,
  configuration: PrintConfiguration,
) {
  const value = object(await printRequest(printBase(id), { operationId, configuration }));
  const preflight = parsePrintPreflight(value?.preflight),
    pack = value?.pack === null ? null : parsePrintPackView(value?.pack);
  if (!preflight || (preflight.outcome === 'ready' && !pack)) throw new Error('invalid_response');
  return { preflight, pack };
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}
