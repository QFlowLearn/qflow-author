import { and, asc, eq } from 'drizzle-orm';
import type { DbReadConnection } from '../db.ts';
import { releaseArtifacts, releaseBuildAttempts } from '../db/release_artifact_schema.ts';
import { parseReleaseArtifactReceipt, parseReleaseBuildReport } from '../banks/release_artifact.ts';

/** Read artifact metadata within the caller's authorized edition snapshot. */
export async function loadReleaseArtifactPreview(
  database: DbReadConnection,
  tenantId: string,
  releaseId: string,
) {
  const rows = await database.select().from(releaseArtifacts).innerJoin(
    releaseBuildAttempts,
    eq(releaseBuildAttempts.id, releaseArtifacts.currentAttemptId),
  )
    .where(and(eq(releaseArtifacts.tenantId, tenantId), eq(releaseArtifacts.releaseId, releaseId)))
    .orderBy(asc(releaseArtifacts.createdAt));
  return rows.map(({ release_artifacts: artifact, release_build_attempts: attempt }) => {
    const state = attempt.state;
    if (
      state !== 'queued' && state !== 'running' && state !== 'candidate' && state !== 'ready' &&
      state !== 'blocked' && state !== 'failed'
    ) throw new Error('Invalid persisted release build state.');
    return {
      id: artifact.id,
      destination: artifact.destination,
      compiler: artifact.compiler,
      policy: artifact.policy,
      attemptId: attempt.id,
      actorId: attempt.actorId,
      state,
      report: attempt.report === null ? null : parseReleaseBuildReport(attempt.report),
      candidateDigest: attempt.candidateDigest,
      receipt: artifact.receipt === null ? null : parseReleaseArtifactReceipt(artifact.receipt),
    };
  });
}
