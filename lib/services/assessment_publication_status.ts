import { collectPackageAssets } from '../package_export.ts';
import { getUpload, uploadIdFromUrl } from '../uploads.ts';
import { and, eq } from 'drizzle-orm';
import type { DbReadConnection } from '../db.ts';
import { assessmentDeliveryPublishAttempts, assessmentExportReceipts } from '../db/schema.ts';
import {
  type AssessmentPublicationStatus,
  publishedCanonicalRevision,
} from '../assessment_publication_status.ts';
import { readDeliverySummary } from '../delivery_metadata.ts';
import {
  buildValidatedQti3Assessment,
  toAssessmentExportSelectionDocument,
} from '../export/assessment.ts';
import { createAssessmentCanonicalRevisionId } from '../export/assessment_export_preflight.ts';
import { loadAssessmentItemExports } from '../export/assessment_loader.ts';
import type { RequestContext } from '../tenants.ts';
import type { AssessmentRecord } from './assessment_records.ts';

import type { ObjectReader } from '../storage_contract.ts';
import type { AssessmentPublicationReview } from '../assessment_publication_review.ts';
import { parseAssessmentExportReceiptEvidence } from '../export/assessment_export_receipt_evidence.ts';
import {
  assessmentExportArtifactStorageKey,
  readMaterializedAssessmentExportArtifact,
} from '../export/assessment_export_artifact.ts';
import { comparePublishedAssessmentPackage } from '../export/assessment_publication_comparison.ts';

export async function readAssessmentPublicationStatus(
  database: DbReadConnection,
  auth: RequestContext,
  assessment: AssessmentRecord,
): Promise<AssessmentPublicationStatus> {
  return (await loadPublicationComparison(database, auth, assessment))?.status ?? 'unavailable';
}

export async function readAssessmentPublicationReview(
  database: DbReadConnection,
  auth: RequestContext,
  assessment: AssessmentRecord,
  storage: ObjectReader,
): Promise<AssessmentPublicationReview> {
  const comparison = await loadPublicationComparison(database, auth, assessment);
  if (!comparison) return { status: 'unavailable' };
  if (comparison.status === 'current') return { status: 'current' };
  const evidence = parseAssessmentExportReceiptEvidence(comparison.receipt);
  if (!evidence.ok || evidence.value.target.id !== 'qti3-conformant') {
    return { status: 'unavailable' };
  }
  const artifact = await readMaterializedAssessmentExportArtifact(storage, {
    ...evidence.value.package,
    storageKey: assessmentExportArtifactStorageKey({
      tenantId: auth.tenantId,
      assessmentId: assessment.id,
      artifactSha256: evidence.value.package.sha256,
    }),
  });
  if (!artifact.ok) return { status: 'unavailable' };
  const collected = await collectPackageAssets({
    _tag: 'Assessment',
    assessmentXml: comparison.assessmentXml,
    itemsXml: comparison.itemsXml,
  }, {
    getUploadId: uploadIdFromUrl,
    getUpload: async (id) => {
      const result = await getUpload(auth, id);
      return result.status === 'ok' ? result.upload : null;
    },
    readUploadFile: (upload) => storage.readObject(upload.path),
  });
  if (!collected.ok) return { status: 'unavailable' };
  const packaged = collected.value;
  return comparePublishedAssessmentPackage(artifact.value, {
    assessmentXml: packaged.assessmentXml,
    itemsXml: packaged.rewrittenXml,
  });
}

/** Compare against the exact receipt bound to the latest successful publication. */
async function loadPublicationComparison(
  database: DbReadConnection,
  auth: RequestContext,
  assessment: AssessmentRecord,
) {
  const delivery = readDeliverySummary(assessment.metadata);
  const attemptId = delivery?.publishId?.match(/^qflow-([0-9a-f-]{36})$/)?.[1];
  if (!attemptId) return null;
  const [row] = await database.select({
    receiptId: assessmentExportReceipts.id,
    receipt: assessmentExportReceipts.receipt,
  }).from(assessmentDeliveryPublishAttempts).innerJoin(
    assessmentExportReceipts,
    eq(assessmentExportReceipts.id, assessmentDeliveryPublishAttempts.exportReceiptId),
  ).where(and(
    eq(assessmentDeliveryPublishAttempts.id, attemptId),
    eq(assessmentDeliveryPublishAttempts.tenantId, auth.tenantId),
    eq(assessmentDeliveryPublishAttempts.assessmentId, assessment.id),
    eq(assessmentDeliveryPublishAttempts.phase, 'published'),
    eq(assessmentExportReceipts.tenantId, auth.tenantId),
    eq(assessmentExportReceipts.assessmentId, assessment.id),
  )).limit(1);
  if (!row) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(row.receipt);
  } catch {
    return null;
  }
  const published = publishedCanonicalRevision(raw, assessment.id, row.receiptId);
  if (!published) return null;
  const exported = await loadAssessmentItemExports(
    database,
    auth,
    toAssessmentExportSelectionDocument(assessment),
  );
  const test = await buildValidatedQti3Assessment(exported.document);
  const current = await createAssessmentCanonicalRevisionId({
    assessmentId: assessment.id,
    assessmentXml: test.xml,
    itemsXml: exported.itemsXml,
  });
  return {
    status: current === published ? 'current' as const : 'changed' as const,
    receipt: raw,
    assessmentXml: test.xml,
    itemsXml: exported.itemsXml,
  };
}
