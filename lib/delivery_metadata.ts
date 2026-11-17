import { isSafeHttpsUrl } from './http_url.ts';

export type DeliverySummary = {
  publishId?: string;
  assessmentId?: string;
  assessmentVersionId: string;
  assignmentId?: string;
  previewUrl?: string;
  adminUrl?: string;
  publishedAt: string;
};

export function readDeliverySummary(metadata: unknown): DeliverySummary | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const metadataRecord = metadata as Record<string, unknown>;
  const delivery = metadataRecord.delivery;
  if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) return null;
  const latest = (delivery as Record<string, unknown>).latestPublish;
  if (!latest || typeof latest !== 'object' || Array.isArray(latest)) return null;
  const record = latest as Record<string, unknown>;
  if (
    typeof record.assessmentVersionId !== 'string' ||
    typeof record.publishedAt !== 'string'
  ) {
    return null;
  }

  return {
    ...(typeof record.publishId === 'string' ? { publishId: record.publishId } : {}),
    assessmentId: typeof record.assessmentId === 'string' ? record.assessmentId : undefined,
    assessmentVersionId: record.assessmentVersionId,
    assignmentId: typeof record.assignmentId === 'string' ? record.assignmentId : undefined,
    previewUrl: isSafeHttpsUrl(record.previewUrl) ? record.previewUrl : undefined,
    adminUrl: isSafeHttpsUrl(record.adminUrl) ? record.adminUrl : undefined,
    publishedAt: record.publishedAt,
  };
}
