import { canonicalJsonStringify } from '../canonical_json.ts';
import { sha256Hex } from '../sha256.ts';
import { printSourceDigest } from './print_snapshot.ts';
import { parsePrintSnapshot, type PrintSnapshot } from './print_snapshot.ts';
import type { assessmentPrintPacks } from '../db/assessment_print_schema.ts';
import type { PrintFailureCode } from './print_contract.ts';

/** One immutable PDF slot, separately authorized at delivery. */
export type PrintPdfArtifact = {
  readonly key: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly pages: number;
};
/** A complete paired candidate; incomplete writes never have this state. */
export type PrintCandidate = {
  readonly digest: string;
  readonly sourceDigest: string;
  readonly student: PrintPdfArtifact;
  readonly marking: PrintPdfArtifact;
  readonly checks: readonly string[];
};
type Base = {
  readonly id: string;
  readonly tenantId: string;
  readonly assessmentId: string;
  readonly actorId: string;
  readonly operationId: string;
  readonly snapshot: PrintSnapshot;
  readonly workflowExecutionId: string | null;
};
/** Stored lifecycle reconstructed with its state-dependent evidence. */
export type PrintPack =
  & Base
  & (
    | { readonly state: 'preparing' | 'queued' | 'building'; readonly candidate: null }
    | { readonly state: 'failed'; readonly candidate: null; readonly failureCode: PrintFailureCode }
    | { readonly state: 'preview-ready'; readonly candidate: PrintCandidate }
    | {
      readonly state: 'confirmed';
      readonly candidate: PrintCandidate;
      readonly confirmedBy: string;
      readonly confirmedAt: string;
      readonly manifest: string;
      readonly manifestSha256: string;
    }
  );

/** Parse stored JSON and reject contradictory ownership/lifecycle before services use it. */
export function parsePrintPack(row: typeof assessmentPrintPacks.$inferSelect): PrintPack | null {
  const snapshot = parsePrintSnapshot(row.snapshot);
  if (
    !snapshot || snapshot.id !== row.id || snapshot.tenantId !== row.tenantId ||
    snapshot.source.assessmentId !== row.assessmentId || snapshot.sourceDigest !== row.sourceDigest
  ) return null;
  const base: Base = {
    id: row.id,
    tenantId: row.tenantId,
    assessmentId: row.assessmentId,
    actorId: row.actorId,
    operationId: row.operationId,
    snapshot,
    workflowExecutionId: row.workflowExecutionId,
  };
  if (row.state === 'preparing' || row.state === 'queued' || row.state === 'building') {
    return row.candidate === null && row.confirmedAt === null && row.manifest === null
      ? { ...base, state: row.state, candidate: null }
      : null;
  }
  if (row.state === 'failed') {
    const code = [
      'invalid_input',
      'forbidden',
      'not_found',
      'blocked',
      'stale_preview',
      'operation_conflict',
      'storage_failed',
      'render_failed',
      'font_unsupported',
      'not_ready',
      'snapshot_corrupt',
    ].find((code) => code === row.failureCode);
    if (!code || row.candidate !== null) return null;
    // SAFETY: the exact closed failure-code list was checked above.
    return { ...base, state: 'failed', candidate: null, failureCode: code as PrintFailureCode };
  }
  const candidate = parsePrintCandidate(row.candidate, snapshot);
  if (!candidate) return null;
  if (row.state === 'preview-ready' && row.confirmedAt === null && row.manifest === null) {
    return { ...base, state: 'preview-ready', candidate };
  }
  if (
    row.state === 'confirmed' && row.confirmedBy && row.confirmedAt && row.manifest &&
    row.manifestSha256 && digest(row.manifestSha256)
  ) {
    return {
      ...base,
      state: 'confirmed',
      candidate,
      confirmedBy: row.confirmedBy,
      confirmedAt: row.confirmedAt.toISOString(),
      manifest: row.manifest,
      manifestSha256: row.manifestSha256,
    };
  }
  return null;
}

function parsePrintCandidate(input: unknown, snapshot: PrintSnapshot): PrintCandidate | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = Object.fromEntries(Object.entries(input));
  if (
    !digest(value.digest) || value.sourceDigest !== snapshot.sourceDigest ||
    !Array.isArray(value.checks) || !value.checks.every((check) => typeof check === 'string')
  ) return null;
  const student = pdf(value.student, snapshot, 'student'),
    marking = pdf(value.marking, snapshot, 'marking');
  return student && marking
    ? {
      digest: value.digest,
      sourceDigest: snapshot.sourceDigest,
      student,
      marking,
      checks: value.checks,
    }
    : null;
}
function pdf(
  input: unknown,
  snapshot: PrintSnapshot,
  kind: 'student' | 'marking',
): PrintPdfArtifact | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = Object.fromEntries(Object.entries(input));
  if (
    !digest(value.sha256) ||
    value.key !== `print/${snapshot.tenantId}/${snapshot.id}/pdf/${kind}-${value.sha256}.pdf` ||
    typeof value.byteLength !== 'number' || !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 1 || value.byteLength > 10000000 ||
    typeof value.pages !== 'number' || !Number.isSafeInteger(value.pages) || value.pages < 1 ||
    value.pages > 100
  ) return null;
  return { key: value.key, sha256: value.sha256, byteLength: value.byteLength, pages: value.pages };
}
function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Verify cryptographic linkage after parsing and before adopting/delivering a candidate. */
export async function printPackIdentityValid(pack: PrintPack): Promise<boolean> {
  if (
    await printSourceDigest(
      pack.snapshot.source,
      pack.snapshot.configuration,
      pack.snapshot.assets,
      pack.snapshot,
    ) !== pack.snapshot.sourceDigest
  ) return false;
  if (pack.state !== 'preview-ready' && pack.state !== 'confirmed') return true;
  const { digest, ...pair } = pack.candidate;
  return await sha256Hex(new TextEncoder().encode(canonicalJsonStringify(pair))) === digest;
}
