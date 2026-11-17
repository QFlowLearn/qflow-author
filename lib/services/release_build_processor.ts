import { and, eq } from 'drizzle-orm';
import { db, type QflowDatabase, type QflowDatabaseTransaction } from '../db.ts';
import { releaseArtifacts, releaseBuildAttempts } from '../db/release_artifact_schema.ts';
import { type ObjectStorage } from '../storage_contract.ts';
import { ZipArchive } from '../zip_archive.ts';
import { sha256Hex } from '../sha256.ts';
import { canonicalJsonStringify } from '../canonical_json.ts';
import { compileSakaiPool } from '../export/releases/sakai_pool.ts';
import { parseReleaseManifest, type ReleaseResult } from '../banks/bank_release.ts';
import {
  parseReleaseBuildReport,
  RELEASE_COMPILER,
  RELEASE_DESTINATION,
  RELEASE_POLICY,
  type ReleaseArtifactReceipt,
  type ReleaseBuildReport,
} from '../banks/release_artifact.ts';
import {
  authorizedFrozenRelease,
  claimReleaseBuild,
  releaseBuildActor,
} from './release_artifacts.ts';

/** Serializable claim, with no ambient membership or latest-question lookup. */
export type ClaimedReleaseBuild = NonNullable<Awaited<ReturnType<typeof claimReleaseBuild>>>;

/** Compile the retained source archive, then adopt bytes only for the currently authorized attempt. */
export async function processReleaseBuild(
  claim: ClaimedReleaseBuild,
  { storage, database = db, now = () => new Date() }: {
    readonly storage: ObjectStorage;
    readonly database?: QflowDatabase;
    readonly now?: () => Date;
  },
): Promise<ReleaseResult<null>> {
  let source: Uint8Array;
  try {
    source = await storage.readObject(claim.source.key);
  } catch {
    return { ok: false, code: 'storage_failed' };
  }
  if (
    source.byteLength !== claim.source.byteLength || await sha256Hex(source) !== claim.source.sha256
  ) {
    return await finalizeReleaseBuild(
      claim,
      {
        blocked: [{ revisionId: '', code: 'source_identity_mismatch' }],
        excluded: [],
        warnings: [],
      },
      null,
      database,
      now(),
    );
  }
  let items: { revisionId: string; xml: string }[];
  try {
    const archive = await ZipArchive.open(source, {
      maxCompressedBytes: 64_000_000,
      maxEntries: 5000,
      maxTotalUncompressedBytes: 64_000_000,
    });
    try {
      items = [];
      for (const item of claim.manifest.items) {
        const entry = archive.file(`items/${item.revisionId}.xml`);
        if (!entry) throw new Error('Missing pinned revision.');
        items.push({ revisionId: item.revisionId, xml: await entry.async('string') });
      }
    } finally {
      await archive.close();
    }
  } catch {
    return await finalizeReleaseBuild(
      claim,
      { blocked: [{ revisionId: '', code: 'invalid_source_archive' }], excluded: [], warnings: [] },
      null,
      database,
      now(),
    );
  }
  const compiled = await compileSakaiPool({
    id: claim.releaseId,
    label: claim.manifest.label,
    items,
  });
  if (!compiled.ok) {
    return await finalizeReleaseBuild(
      claim,
      { blocked: compiled.blocked, excluded: [], warnings: [] },
      null,
      database,
      now(),
    );
  }
  const report: ReleaseBuildReport = {
    blocked: [],
    excluded: compiled.excluded,
    warnings: [
      ...new Set([
        ...compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').map((
          diagnostic,
        ) => diagnostic.code),
        ...(claim.manifest.collections.length ? ['sakai.flat_pool'] : []),
        ...(compiled.excluded.length ? ['sakai.questions_excluded'] : []),
      ]),
    ].sort(),
  };
  const bytes = new TextEncoder().encode(compiled.xml), sha256 = await sha256Hex(bytes);
  try {
    await storage.putObject({
      key: claim.objectKey,
      data: bytes,
      contentType: 'application/xml',
      immutableIdentity: { sha256 },
    });
  } catch {
    return { ok: false, code: 'storage_failed' };
  }
  return await finalizeReleaseBuild(
    claim,
    report,
    { sha256, byteLength: bytes.byteLength },
    database,
    now(),
  );
}

async function finalizeReleaseBuild(
  claim: ClaimedReleaseBuild,
  report: ReleaseBuildReport,
  output: { sha256: string; byteLength: number } | null,
  database: QflowDatabase,
  now: Date,
): Promise<ReleaseResult<null>> {
  return await database.transaction(async (tx) => {
    const ctx = await releaseBuildActor(tx, claim.tenantId, claim.actorId);
    if (!ctx) return { ok: false, code: 'forbidden' };
    const release = await authorizedFrozenRelease(tx, ctx, claim.releaseId);
    if (!release.ok) return release;
    const [artifact] = await tx.select().from(releaseArtifacts).where(
      and(eq(releaseArtifacts.id, claim.artifactId), eq(releaseArtifacts.tenantId, claim.tenantId)),
    ).for('update');
    const [attempt] = await tx.select().from(releaseBuildAttempts).where(
      eq(releaseBuildAttempts.id, claim.attemptId),
    ).for('update');
    if (
      !artifact || !attempt || artifact.currentAttemptId !== claim.attemptId ||
      attempt.actorId !== claim.actorId
    ) return { ok: false, code: 'stale_preview' };
    if (artifact.receipt !== null || ['candidate', 'ready', 'blocked'].includes(attempt.state)) {
      return { ok: true, value: null };
    }
    if (attempt.state !== 'running') return { ok: false, code: 'invalid_transition' };
    if (!output || report.blocked.length) {
      await tx.update(releaseBuildAttempts).set({ state: 'blocked', report, generatedAt: now })
        .where(eq(releaseBuildAttempts.id, attempt.id));
      return { ok: true, value: null };
    }
    const candidateDigest = await sha256Hex(
      new TextEncoder().encode(
        canonicalJsonStringify({
          attemptId: attempt.id,
          policy: artifact.policy,
          report,
          ...output,
        }),
      ),
    );
    const next = { ...attempt, ...output, candidateDigest, generatedAt: now, report };
    if (!report.warnings.length) {
      const receipt = makeReleaseReceipt(
        artifact,
        next,
        parseReleaseManifest(release.value.manifest),
        null,
      );
      await tx.update(releaseArtifacts).set({ receipt }).where(
        eq(releaseArtifacts.id, artifact.id),
      );
    }
    await tx.update(releaseBuildAttempts).set({
      state: report.warnings.length ? 'candidate' : 'ready',
      report,
      ...output,
      candidateDigest,
      generatedAt: now,
    }).where(eq(releaseBuildAttempts.id, attempt.id));
    return { ok: true, value: null };
  });
}

/** Build a receipt only from persisted identity and exact candidate output. */
export function makeReleaseReceipt(
  artifact: typeof releaseArtifacts.$inferSelect,
  attempt: typeof releaseBuildAttempts.$inferSelect,
  manifest: ReturnType<typeof parseReleaseManifest>,
  acknowledgement: ReleaseArtifactReceipt['acknowledgement'],
): ReleaseArtifactReceipt {
  const report = parseReleaseBuildReport(attempt.report);
  const excludedIds = new Set(report.excluded.map((item) => item.revisionId));
  const revisionIds = manifest.items.filter((item) => !excludedIds.has(item.revisionId))
    .map((item) => item.revisionId);
  if (
    !attempt.sha256 || attempt.byteLength === null || !attempt.generatedAt ||
    !manifest.preparation || report.blocked.length ||
    artifact.compiler !== RELEASE_COMPILER || artifact.destination !== RELEASE_DESTINATION ||
    artifact.policy !== RELEASE_POLICY ||
    (report.warnings.length > 0 && !acknowledgement) ||
    !revisionIds.length ||
    report.excluded.some((excluded) =>
      !manifest.items.some((item) => item.revisionId === excluded.revisionId)
    ) || (report.excluded.length > 0 && !report.warnings.includes('sakai.questions_excluded'))
  ) throw new Error('Release receipt lacks valid evidence.');
  return {
    schema: 'qflow.release-artifact.v1',
    artifactId: artifact.id,
    releaseId: artifact.releaseId,
    releaseDigest: artifact.releaseDigest,
    sourceDigest: manifest.preparation.sha256,
    destination: artifact.destination,
    compiler: artifact.compiler,
    policy: artifact.policy,
    attemptId: attempt.id,
    actorId: attempt.actorId,
    generatedAt: attempt.generatedAt.toISOString(),
    sha256: attempt.sha256,
    byteLength: attempt.byteLength,
    mediaType: 'application/xml',
    revisionIds,
    excluded: report.excluded,
    warnings: report.warnings,
    acknowledgement,
  };
}

/** A terminal platform execution cannot strand an unfinished domain attempt as Running. */
export async function settleReleaseBuildAfterWorkflowTerminal(
  tx: QflowDatabaseTransaction,
  input: { jobId: string; tenantId: string },
) {
  const [attempt] = await tx.select().from(releaseBuildAttempts).where(
    and(
      eq(releaseBuildAttempts.id, input.jobId),
      eq(releaseBuildAttempts.tenantId, input.tenantId),
    ),
  ).for('update');
  if (!attempt) return { _tag: 'JobMissing' } as const;
  if (['ready', 'candidate', 'blocked'].includes(attempt.state)) {
    return { _tag: 'AlreadyCompleted' } as const;
  }
  if (attempt.state === 'failed') return { _tag: 'AlreadyFailed' } as const;
  await tx.update(releaseBuildAttempts).set({
    state: 'failed',
    report: {
      blocked: [{ revisionId: '', code: 'workflow_terminal' }],
      excluded: [],
      warnings: [],
    },
  }).where(eq(releaseBuildAttempts.id, attempt.id));
  return { _tag: 'Failed' } as const;
}
