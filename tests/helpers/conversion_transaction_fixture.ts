import type { AssessmentStandaloneContent } from '../../lib/assessment_standalone_content.ts';

import { eq } from 'drizzle-orm';
import { db, shutdownDb } from '../../lib/db.ts';
import {
  assessments,
  auditLogs,
  conversionSourceArtifacts,
  migrationAssets,
  migrationBatches,
  migrationItems,
  migrationRuns,
  organizationMemberships,
  questions,
  tenants,
  uploadsTable,
  users,
} from '../../lib/db/schema.ts';

import {
  acceptedMigrationQuestionSnapshotHash,
  createAcceptedMigrationQuestionSnapshot,
  migrationItemContentHash,
  migrationItemContextHash,
} from '../../lib/import/migration_item_content.ts';
import { projectJsonPersistenceObject } from '../../lib/canonical_json.ts';
import { encodeBase64 } from '../../lib/base64.ts';
import { sha256Hex } from '../../lib/sha256.ts';

import type { RequestContext } from '../../lib/tenants.ts';
import { testAssessmentBlueprint } from '../assessment_blueprint_fixture.ts';
import { questionXmlFixture } from '../question_xml_fixture.ts';
import { newAuthoringItemLanguage } from '../../lib/types/item_language.ts';

const HASH_A = 'a'.repeat(64), HASH_B = 'b'.repeat(64);
export async function createConversionFixture(input: {
  includeInvalidItem: boolean;
  includeAsset?: boolean;
  bank?: boolean;
  validItemCount?: number;
  text?: string;
  content?: readonly AssessmentStandaloneContent[];
}): Promise<{
  tenantId: string;
  userId: string;
  runId: string;
  itemIds: string[];
  itemVersions: Record<string, { contentHash: string; contextHash: string }>;
  ctx: RequestContext;
}> {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const originalArtifactId = crypto.randomUUID();
  const normalizedArtifactId = crypto.randomUUID();
  const reviewedAt = new Date('2026-07-30T12:00:00.000Z');
  const userEmail = `conversion-${userId.slice(0, 8)}@example.com`;
  const actor = {
    id: userId,
    email: userEmail,
    displayName: 'Conversion Test User',
  };
  const validItemCount = input.validItemCount ?? 1;
  const itemIds = Array.from({ length: validItemCount }, () => crypto.randomUUID());
  if (input.includeInvalidItem) itemIds.push(crypto.randomUUID());
  const itemDrafts = itemIds.map((_, index) =>
    index >= validItemCount
      ? {
        type: 'single_select',
        itemLanguage: newAuthoringItemLanguage(),
        title: 'Invalid question',
        bodyHtml: '<p>Missing choices</p>',
        choices: [],
        correctId: 'missing',
      }
      : validDraft()
  );
  const itemTitles = itemDrafts.map(fixtureDraftTitle);
  const assetData = new Uint8Array([1, 2, 3]);
  const assetSha256 = await sha256Hex(assetData);
  const reviewedAssets = input.includeAsset
    ? [{
      sourcePath: 'assets/a.png',
      name: 'a.png',
      mimeType: 'image/png',
      size: assetData.byteLength,
      sha256: assetSha256,
    }]
    : [];
  const itemXml = itemIds.map((_, index) =>
    input.includeAsset && index === 0
      ? questionXmlFixture('conversion-item').replace(
        '<p>Test item</p>',
        '<img src="../assets/a.png" alt="Test asset" />',
      )
      : questionXmlFixture('conversion-item')
  );
  const contentHashes = await Promise.all(
    itemDrafts.map((draft, index) =>
      migrationItemContentHash({
        sourceName: 'transaction-test.xml',
        title: itemTitles[index],
        itemType: 'single_select',
        sourceHref: `items/${index + 1}.xml`,
        sourceIdentifier: itemIds[index],
        sourceXml: itemXml[index],
        importedDraft: draft,
        blueprintTargetId: input.bank ? null : 'choice-target',
        reviewSuggestions: [],
        warnings: [],
        assets: reviewedAssets,
      })
    ),
  );
  const contextHashes = await Promise.all(itemIds.map(() =>
    migrationItemContextHash({
      readiness: 'ready',
      sourceArtifact: {
        id: originalArtifactId,
        filename: 'transaction-test.xml',
        mimeType: 'application/xml',
        size: 100,
        sha256: HASH_A,
      },
      normalizedSourceSha256: HASH_B,
      evidence: [],
      extractionUncertainties: [],
      review: {
        decision: 'accepted',
        note: null,
        reviewedBy: userId,
        reviewedAt: reviewedAt.toISOString(),
      },
    })
  ));
  const acceptedSnapshots = itemIds.map((itemId, index) =>
    createAcceptedMigrationQuestionSnapshot({
      contentHash: contentHashes[index],
      contextHash: contextHashes[index],
      origin: {
        _tag: 'Imported',
        artifact: {
          id: originalArtifactId,
          filename: 'transaction-test.xml',
          mimeType: 'application/xml',
          size: 100,
          sha256: HASH_A,
        },
        migrationRunId: runId,
        migrationItemId: itemId,
        href: `items/${index + 1}.xml`,
        identifier: itemId,
        providedBy: actor,
        assistance: {
          _tag: 'DeterministicImport',
          adapter: { id: 'qti21', label: 'QTI 2.1', version: '1' },
        },
        evidence: [],
        review: {
          decision: 'accepted',
          reviewer: actor,
          reviewedAt: reviewedAt.toISOString(),
          note: null,
          contentHash: contentHashes[index],
          contextHash: contextHashes[index],
        },
      },
    })
  );
  const acceptedSnapshotHashes = await Promise.all(
    acceptedSnapshots.map(acceptedMigrationQuestionSnapshotHash),
  );
  const itemVersions = Object.fromEntries(itemIds.map((itemId, index) => [
    itemId,
    { contentHash: contentHashes[index], contextHash: contextHashes[index] },
  ]));

  await db.insert(tenants).values({
    id: tenantId,
    slug: `conversion-${tenantId.slice(0, 8)}`,
    name: 'Conversion Transaction Test',
  });
  await db.insert(users).values({
    id: userId,
    email: userEmail,
    emailNormalized: userEmail,
    displayName: 'Conversion Test User',
    authProvider: 'local',
    authProviderId: `conversion-${userId.slice(0, 8)}`,
  });
  if (input.bank) {
    await db.insert(organizationMemberships).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      role: 'owner',
    });
  }
  const batchId = crypto.randomUUID();
  await db.insert(migrationBatches).values({
    id: batchId,
    tenantId,
    createdBy: userId,
    createdBySnapshot: projectJsonPersistenceObject(actor),
    purpose: 'recover_existing',
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: HASH_A,
    sourceCount: 1,
  });
  await db.insert(migrationRuns).values({
    destination: input.bank ? 'WorkspaceBank' : 'Assessment',
    id: runId,
    batchId,
    batchPosition: 1,
    tenantId,
    sourceFilename: 'transaction-test.xml',
    sourceMime: 'application/xml',
    sourceSize: 100,
    adapterId: 'qti21',
    adapterLabel: 'QTI 2.1',
    adapterVersion: '1',
    blueprint: input.bank ? null : testAssessmentBlueprint([
      { id: 'choice-target', questionType: 'single_select', count: itemIds.length },
    ]),
    status: 'analyzed',
    attempts: 0,
    maxAttempts: 3,
    approvalStatus: 'approved',
    submittedBy: userId,
    submittedAt: new Date(),
    decidedBy: userId,
    decidedAt: new Date(),
    completedAt: new Date(),
    parts: [{
      id: 'source-part',
      title: 'Imported questions',
      placements: itemIds.flatMap((itemId, index) => [
        { href: `items/${index + 1}.xml`, refIdentifier: itemId },
        ...(index === 0 && input.content
          ? input.content.map((content, position) => ({
            content,
            refIdentifier: `content-${position}`,
          }))
          : []),
        ...(index === 0 && input.text !== undefined
          ? [{ content: { kind: 'text', text: input.text }, refIdentifier: 'instructions' }]
          : []),
      ]),
      options: {},
    }],
    summary: {
      title: 'Transaction test',
      counts: {
        parts: 1,
        items: itemIds.length,
        assets: reviewedAssets.length,
        warnings: 0,
        ready: itemIds.length,
        reviewNeeded: 0,
        blocked: 0,
      },
      warningCounts: {},
      itemTypeCounts: { single_select: itemIds.length },
    },
  });
  await db.insert(conversionSourceArtifacts).values({
    id: originalArtifactId,
    runId,
    kind: 'original',
    filename: 'transaction-test.xml',
    mimeType: 'application/xml',
    size: 100,
    sha256: HASH_A,
    storageKey: `conversion/${runId}/source`,
    document: null,
  });
  await db.insert(conversionSourceArtifacts).values({
    id: normalizedArtifactId,
    runId,
    kind: 'normalized',
    filename: 'transaction-test.xml.normalized.json',
    mimeType: 'application/vnd.qflow.structured-source+json',
    size: 100,
    sha256: HASH_B,
    storageKey: `conversion/${runId}/normalized`,
    document: {
      version: 1,
      title: 'Transaction test',
      sourceKind: 'package',
      blocks: [],
      text: '',
      uncertainties: [],
    },
  });
  if (input.includeAsset) {
    await db.insert(migrationAssets).values({
      id: crypto.randomUUID(),
      runId,
      sourcePath: 'assets/a.png',
      name: 'a.png',
      mimeType: 'image/png',
      size: assetData.byteLength,
      sha256: assetSha256,
      dataBase64: encodeBase64(assetData),
    });
  }
  for (const [index, itemId] of itemIds.entries()) {
    const contentHash = contentHashes[index];
    await db.insert(migrationItems).values({
      id: itemId,
      runId,
      sourceHref: `items/${index + 1}.xml`,
      sourceIdentifier: itemId,
      title: itemTitles[index],
      itemType: 'single_select',
      position: index + 1,
      readiness: 'ready',
      warnings: [],
      sourceXml: itemXml[index],
      importedDraft: itemDrafts[index],
      blueprintTargetId: input.bank ? null : 'choice-target',
      reviewSuggestions: [],
      decision: 'accepted',
      evidence: [],
      extractionUncertainties: [],
      contentHash,
      contextHash: contextHashes[index],
      acceptedSnapshot: projectJsonPersistenceObject(acceptedSnapshots[index]),
      acceptedSnapshotHash: acceptedSnapshotHashes[index],
      reviewedBy: userId,
      reviewedAt,
    });
  }
  return {
    tenantId,
    userId,
    runId,
    itemIds,
    itemVersions,
    ctx: { tenantId, userId, role: 'owner' },
  };
}
function validDraft(): Record<string, unknown> {
  return {
    type: 'single_select',
    itemLanguage: newAuthoringItemLanguage(),
    title: 'Valid question',
    promptHtml: '',
    bodyHtml: '<p>Which answer is correct?</p>',
    choices: [{ id: 'A', text: 'Correct' }, { id: 'B', text: 'Incorrect' }],
    correctId: 'A',
    shuffle: false,
    required: true,
    tags: [],
  };
}
function fixtureDraftTitle(draft: Record<string, unknown>): string {
  if (typeof draft.title !== 'string') throw new Error('Fixture draft title is required.');
  return draft.title;
}
export async function cleanupFixture(fixture: {
  tenantId: string;
  userId: string;
  runId: string;
}): Promise<void> {
  try {
    await db.delete(migrationRuns).where(eq(migrationRuns.id, fixture.runId));
    await db.delete(migrationBatches).where(
      eq(migrationBatches.tenantId, fixture.tenantId),
    );
    await db.delete(assessments).where(eq(assessments.tenantId, fixture.tenantId));
    await db.delete(questions).where(eq(questions.tenantId, fixture.tenantId));
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, fixture.tenantId));
    await db.delete(uploadsTable).where(eq(uploadsTable.tenantId, fixture.tenantId));
    await db.delete(users).where(eq(users.id, fixture.userId));
    await db.delete(tenants).where(eq(tenants.id, fixture.tenantId));
  } catch {
    // Cleanup must not hide the primary assertion.
  } finally {
    await shutdownDb().catch(() => {});
  }
}
