import { and, eq } from 'drizzle-orm';
import { db, type QflowDatabase } from '../db.ts';
import { releaseArtifacts, releaseBuildAttempts } from '../db/release_artifact_schema.ts';
import { bankReleaseEvents } from '../db/bank_release_schema.ts';
import { parseReleaseManifest, type ReleaseResult, uuid } from '../banks/bank_release.ts';
import {
  parseReleaseArtifactReceipt,
  parseReleaseBuildReport,
  parseReleaseCandidateConfirmation,
} from '../banks/release_artifact.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { sha256Hex } from '../sha256.ts';
import type { ObjectStorage } from '../storage_contract.ts';
import type { RequestContext } from '../tenants.ts';
import { authorizedFrozenRelease } from './release_artifacts.ts';
import { makeReleaseReceipt } from './release_build_processor.ts';
import { recordReleaseEvent } from './bank_releases.ts';

/** Confirm only this publisher's exact candidate and policy. Blocked output has no confirmation path. */
export async function acknowledgeReleaseCandidate(
  ctx: RequestContext,
  releaseId: string,
  input: unknown,
  { database = db, now = () => new Date() }: {
    readonly database?: QflowDatabase;
    readonly now?: () => Date;
  } = {},
): Promise<ReleaseResult<null>> {
  const command = parseReleaseCandidateConfirmation(input);
  if (!command || !uuid(releaseId)) return { ok: false, code: 'invalid_input' };
  return await database.transaction(async (tx) => {
    const release = await authorizedFrozenRelease(tx, ctx, releaseId);
    if (!release.ok) return release;
    const [attempt] = await tx.select().from(releaseBuildAttempts).where(
      and(
        eq(releaseBuildAttempts.id, command.attemptId),
        eq(releaseBuildAttempts.tenantId, ctx.tenantId),
      ),
    ).for('update');
    if (!attempt) return { ok: false, code: 'not_found' };
    const [artifact] = await tx.select().from(releaseArtifacts).where(
      eq(releaseArtifacts.id, attempt.artifactId),
    ).for('update');
    if (!artifact || artifact.releaseId !== releaseId) return { ok: false, code: 'not_found' };
    if (attempt.actorId !== ctx.userId) return { ok: false, code: 'forbidden' };
    if (
      artifact.currentAttemptId !== attempt.id ||
      attempt.candidateDigest !== command.candidateDigest || artifact.policy !== command.policy
    ) return { ok: false, code: 'stale_preview' };
    if (attempt.state === 'ready' && artifact.receipt !== null) return { ok: true, value: null };
    const report = attempt.report === null ? null : parseReleaseBuildReport(attempt.report);
    if (
      attempt.state !== 'candidate' || !report || report.blocked.length || !report.warnings.length
    ) return { ok: false, code: 'invalid_transition' };
    const receipt = makeReleaseReceipt(
      artifact,
      attempt,
      parseReleaseManifest(release.value.manifest),
      {
        actorId: ctx.userId,
        candidateDigest: command.candidateDigest,
        policy: command.policy,
        acknowledgedAt: now().toISOString(),
      },
    );
    await tx.update(releaseArtifacts).set({ receipt }).where(eq(releaseArtifacts.id, artifact.id));
    await tx.update(releaseBuildAttempts).set({ state: 'ready' }).where(
      eq(releaseBuildAttempts.id, attempt.id),
    );
    return { ok: true, value: null };
  });
}

/** Retrieve original package bytes, verifying identity and reauthorizing after storage I/O. */
export async function downloadReleaseArtifact(
  ctx: RequestContext,
  releaseId: string,
  artifactId: string,
  operationId: string,
  { storage, database = db, now = () => new Date() }: {
    readonly storage: ObjectStorage;
    readonly database?: QflowDatabase;
    readonly now?: () => Date;
  },
) {
  if (![releaseId, artifactId, operationId].every(uuid)) {
    return { ok: false, code: 'invalid_input' } as const;
  }
  const authorize = () =>
    database.transaction(async (tx) => {
      const release = await authorizedFrozenRelease(tx, ctx, releaseId);
      if (!release.ok) return release;
      const [artifact] = await tx.select().from(releaseArtifacts).where(
        and(
          eq(releaseArtifacts.id, artifactId),
          eq(releaseArtifacts.releaseId, releaseId),
          eq(releaseArtifacts.tenantId, ctx.tenantId),
        ),
      );
      if (!artifact) return { ok: false, code: 'not_found' } as const;
      if (artifact.receipt === null) return { ok: false, code: 'invalid_transition' } as const;
      const receipt = parseReleaseArtifactReceipt(artifact.receipt);
      const [attempt] = await tx.select().from(releaseBuildAttempts).where(
        eq(releaseBuildAttempts.id, artifact.currentAttemptId),
      );
      if (
        !attempt || attempt.state !== 'ready' || receipt.attemptId !== attempt.id ||
        receipt.sha256 !== attempt.sha256 ||
        receipt.releaseDigest !== release.value.digest || receipt.artifactId !== artifact.id ||
        receipt.byteLength !== attempt.byteLength
      ) throw new Error('Ready artifact identity is inconsistent.');
      return { ok: true, value: { receipt, key: attempt.objectKey } } as const;
    });
  const first = await authorize();
  if (!first.ok) return first;
  let bytes: Uint8Array;
  try {
    bytes = await storage.readObject(first.value.key);
  } catch {
    return { ok: false, code: 'storage_failed' } as const;
  }
  if (
    bytes.byteLength !== first.value.receipt.byteLength ||
    await sha256Hex(bytes) !== first.value.receipt.sha256
  ) return { ok: false, code: 'storage_failed' } as const;
  return await database.transaction(async (tx) => {
    const release = await authorizedFrozenRelease(tx, ctx, releaseId);
    if (!release.ok) return release;
    const command = { action: 'download_package', artifactId, sha256: first.value.receipt.sha256 };
    const [event] = await tx.select().from(bankReleaseEvents).where(
      and(
        eq(bankReleaseEvents.tenantId, ctx.tenantId),
        eq(bankReleaseEvents.operationId, operationId),
      ),
    );
    if (
      event &&
      (event.actorId !== ctx.userId || event.releaseId !== releaseId ||
        canonicalJsonStringify(event.command) !== canonicalJsonStringify(command))
    ) return { ok: false, code: 'operation_conflict' } as const;
    if (!event) await recordReleaseEvent(tx, ctx, releaseId, operationId, command, now());
    return { ok: true, value: { bytes, receipt: first.value.receipt } } as const;
  });
}
