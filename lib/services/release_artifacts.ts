import { and, eq } from 'drizzle-orm';
import { db, type QflowDatabase, type QflowDatabaseTransaction } from '../db.ts';
import {
  bankReleaseEvents,
  bankReleasePreparations,
  bankReleases,
} from '../db/bank_release_schema.ts';
import { releaseArtifacts, releaseBuildAttempts } from '../db/release_artifact_schema.ts';
import { workflowDispatches } from '../db/workflow_canvas_schema.ts';
import { organizationMemberships } from '../db/principal_schema.ts';
import { parseRole } from '../roles.ts';
import { parseReleaseManifest, type ReleaseResult, uuid } from '../banks/bank_release.ts';
import {
  parseReleaseBuildRequest,
  RELEASE_COMPILER,
  RELEASE_DESTINATION,
  RELEASE_POLICY,
} from '../banks/release_artifact.ts';
import type { RequestContext } from '../tenants.ts';
import { lockWorkspaceAndRequireAuthority } from './workspace_authorization.ts';
import { recordReleaseEvent } from './bank_releases.ts';

/** Reconstruct the requesting publisher from current membership; never invent a runner role. */
export async function releaseBuildActor(
  database: QflowDatabase | QflowDatabaseTransaction,
  tenantId: string,
  userId: string,
): Promise<RequestContext | null> {
  const [member] = await database.select().from(organizationMemberships).where(and(
    eq(organizationMemberships.tenantId, tenantId),
    eq(organizationMemberships.userId, userId),
  ));
  const role = parseRole(member?.role);
  return role ? { tenantId, userId, role } : null;
}

/** Lock the edition's distribution authority before any package mutation. */
export async function authorizedFrozenRelease(
  tx: QflowDatabaseTransaction,
  ctx: RequestContext,
  releaseId: string,
) {
  if (!await lockWorkspaceAndRequireAuthority(tx, ctx, { grant: 'publication' })) {
    return { ok: false, code: 'forbidden' } as const;
  }
  const [release] = await tx.select().from(bankReleases).where(
    and(eq(bankReleases.id, releaseId), eq(bankReleases.tenantId, ctx.tenantId)),
  );
  if (!release) return { ok: false, code: 'not_found' } as const;
  if (release.state !== 'frozen') return { ok: false, code: 'not_frozen' } as const;
  if (release.distribution !== 'available') return { ok: false, code: 'withdrawn' } as const;
  return { ok: true, value: release } as const;
}

/** Reserve an actor-bound attempt and its concrete Workflow outbox atomically. */
export async function requestReleaseBuild(
  ctx: RequestContext,
  input: unknown,
  { database = db, now = () => new Date() }: {
    readonly database?: QflowDatabase;
    readonly now?: () => Date;
  } = {},
): Promise<ReleaseResult<string>> {
  const command = parseReleaseBuildRequest(input);
  if (!command) return { ok: false, code: 'invalid_input' };
  return await database.transaction(async (tx) => {
    const release = await authorizedFrozenRelease(tx, ctx, command.releaseId);
    if (!release.ok) return release;
    const [existing] = await tx.select().from(releaseBuildAttempts)
      .innerJoin(releaseArtifacts, eq(releaseArtifacts.id, releaseBuildAttempts.artifactId))
      .where(eq(releaseBuildAttempts.id, command.attemptId));
    if (existing) {
      return existing.release_build_attempts.actorId === ctx.userId &&
          existing.release_build_attempts.tenantId === ctx.tenantId &&
          existing.release_build_attempts.previousAttemptId === command.previousAttemptId &&
          existing.release_artifacts.releaseId === command.releaseId
        ? { ok: true, value: existing.release_artifacts.id }
        : { ok: false, code: 'operation_conflict' };
    }
    const [conflictingEvent] = await tx.select({ operationId: bankReleaseEvents.operationId }).from(
      bankReleaseEvents,
    ).where(and(
      eq(bankReleaseEvents.tenantId, ctx.tenantId),
      eq(bankReleaseEvents.operationId, command.attemptId),
    ));
    if (conflictingEvent) return { ok: false, code: 'operation_conflict' };
    const [artifact] = await tx.select().from(releaseArtifacts).where(and(
      eq(releaseArtifacts.tenantId, ctx.tenantId),
      eq(releaseArtifacts.releaseId, command.releaseId),
      eq(releaseArtifacts.destination, RELEASE_DESTINATION),
      eq(releaseArtifacts.compiler, RELEASE_COMPILER),
      eq(releaseArtifacts.policy, RELEASE_POLICY),
    )).for('update');
    if ((artifact?.currentAttemptId ?? null) !== command.previousAttemptId) {
      return { ok: false, code: 'stale_preview' };
    }
    if (artifact && artifact.receipt !== null) return { ok: false, code: 'invalid_transition' };
    const artifactId = artifact?.id ?? command.attemptId;
    const createdAt = now();
    if (!artifact) {
      await tx.insert(releaseArtifacts).values({
        id: artifactId,
        tenantId: ctx.tenantId,
        releaseId: command.releaseId,
        releaseDigest: release.value.digest,
        destination: RELEASE_DESTINATION,
        compiler: RELEASE_COMPILER,
        policy: RELEASE_POLICY,
        currentAttemptId: command.attemptId,
        createdAt,
      });
    }
    await tx.insert(releaseBuildAttempts).values({
      id: command.attemptId,
      tenantId: ctx.tenantId,
      artifactId,
      actorId: ctx.userId,
      previousAttemptId: command.previousAttemptId,
      state: 'queued',
      objectKey:
        `bank-releases/${ctx.tenantId}/${command.releaseId}/artifacts/${artifactId}/${command.attemptId}.xml`,
      createdAt,
    });
    if (artifact) {
      await tx.update(releaseArtifacts).set({ currentAttemptId: command.attemptId }).where(
        eq(releaseArtifacts.id, artifactId),
      );
    }
    await tx.insert(workflowDispatches).values({
      id: command.attemptId,
      kind: 'release_build',
      jobId: command.attemptId,
      tenantId: ctx.tenantId,
      state: 'pending',
      createdAt,
      updatedAt: createdAt,
    });
    await recordReleaseEvent(tx, ctx, command.releaseId, command.attemptId, {
      action: 'build_package',
      artifactId,
      attemptId: command.attemptId,
      destination: RELEASE_DESTINATION,
      compiler: RELEASE_COMPILER,
      policy: RELEASE_POLICY,
    }, createdAt);
    return { ok: true, value: artifactId };
  });
}

/** Claim only the current attempt, with current actor authority and exact adopted source. */
export async function claimReleaseBuild(
  attemptId: string,
  executionId: string,
  database: QflowDatabase = db,
) {
  if (!uuid(attemptId) || attemptId !== executionId) return null;
  return await database.transaction(async (tx) => {
    const [job] = await tx.select().from(releaseBuildAttempts).where(
      eq(releaseBuildAttempts.id, attemptId),
    );
    if (!job) return null;
    const ctx = await releaseBuildActor(tx, job.tenantId, job.actorId);
    if (!ctx) return null;
    const [artifact] = await tx.select().from(releaseArtifacts).where(
      eq(releaseArtifacts.id, job.artifactId),
    );
    if (
      !artifact || artifact.currentAttemptId !== job.id || artifact.receipt !== null ||
      !['queued', 'running'].includes(job.state)
    ) return null;
    const release = await authorizedFrozenRelease(tx, ctx, artifact.releaseId);
    if (!release.ok) return null;
    // Re-read under the shared workspace lock; a retry may have superseded our first read.
    const [current] = await tx.select().from(releaseArtifacts).where(
      eq(releaseArtifacts.id, artifact.id),
    );
    const [attempt] = await tx.select().from(releaseBuildAttempts).where(
      eq(releaseBuildAttempts.id, job.id),
    );
    if (
      !current || current.currentAttemptId !== job.id || current.receipt !== null ||
      !attempt || !['queued', 'running'].includes(attempt.state)
    ) return null;
    if (
      artifact.releaseDigest !== release.value.digest ||
      artifact.destination !== RELEASE_DESTINATION ||
      artifact.compiler !== RELEASE_COMPILER || artifact.policy !== RELEASE_POLICY
    ) throw new Error('Unsupported release compiler identity.');
    const manifest = parseReleaseManifest(release.value.manifest);
    if (!manifest.preparation) throw new Error('Frozen release has no source.');
    const [source] = await tx.select().from(bankReleasePreparations).where(and(
      eq(bankReleasePreparations.id, manifest.preparation.id),
      eq(bankReleasePreparations.tenantId, ctx.tenantId),
      eq(bankReleasePreparations.releaseId, artifact.releaseId),
      eq(bankReleasePreparations.state, 'adopted'),
    ));
    if (
      !source || source.sha256 !== manifest.preparation.sha256 ||
      source.byteLength !== manifest.preparation.byteLength
    ) throw new Error('Frozen source identity is invalid.');
    await tx.update(releaseBuildAttempts).set({ state: 'running' }).where(
      eq(releaseBuildAttempts.id, job.id),
    );
    return {
      attemptId: job.id,
      tenantId: job.tenantId,
      actorId: job.actorId,
      artifactId: artifact.id,
      releaseId: artifact.releaseId,
      releaseDigest: artifact.releaseDigest,
      objectKey: job.objectKey,
      manifest,
      source: {
        key: source.objectKey,
        sha256: manifest.preparation.sha256,
        byteLength: manifest.preparation.byteLength,
      },
    };
  });
}
