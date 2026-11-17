import type { ImportedOrganizationGroup } from './organization_groups.ts';
import type { ImportWarning } from './types.ts';
import type { MigrationWarningCode } from './migration_warning_catalog.ts';
export type {
  MigrationWarningExplanation,
  MigrationWarningSeverity,
} from './migration_warning_catalog.ts';
import type {
  EvidenceAnchor,
  ExtractionUncertainty,
  StructuredSourceDocument,
} from '../conversion/source_model.ts';
import type { MigrationApprovalState, MigrationExecutionState } from './migration_state.ts';
import type { parseImportedDraft } from './imported_draft.ts';
import type { AcceptedMigrationQuestionSnapshot } from './migration_item_content.ts';
import type { MigrationDestination } from './migration_destination.ts';
import type { QuestionReviewSuggestion } from '../question_review_types.ts';

export type MigrationBatchStatus =
  | 'queued'
  | 'processing'
  | 'review'
  | 'approval'
  | 'completed'
  | 'failed';

export type MigrationItemReadiness = 'ready' | 'minor_review' | 'major_review' | 'blocked';
export type MigrationItemDecision = 'pending' | 'accepted' | 'rejected';

export type MigrationReviewProgress = {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
};

export type MigrationFidelitySummary = {
  total: number;
  semantic: number;
  reviewRequired: number;
  sourcePreserved: number;
};

export type MigrationSummary = {
  title?: string;
  counts: {
    parts: number;
    items: number;
    assets: number;
    warnings: number;
    ready: number;
    reviewNeeded: number;
    blocked: number;
  };
  warningCounts: Partial<Record<MigrationWarningCode, number>>;
  itemTypeCounts: Record<string, number>;
  sniff?: {
    confidence: number;
    reason?: string;
  };
  globalWarnings?: ImportWarning[];
};

export type MigrationItemRecord = {
  id: string;
  runId: string;
  sourceHref: string;
  sourceIdentifier: string;
  title: string;
  itemType: string;
  itemTypeLabel: string;
  position: number;
  readiness: MigrationItemReadiness;
  warnings: ImportWarning[];
  sourceXml: string;
  importedDraft: ReturnType<typeof parseImportedDraft>;
  blueprintTargetId: string | null;
  reviewSuggestions: QuestionReviewSuggestion[];
  createdQuestionId?: string | null;
  createdRevision?: number | null;
  decision: MigrationItemDecision;
  reviewNote?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  evidence: EvidenceAnchor[];
  extractionUncertainties: ExtractionUncertainty[];
  contentHash: string;
  contextHash: string;
  acceptedSnapshot?: AcceptedMigrationQuestionSnapshot | null;
  acceptedSnapshotHash?: string | null;
  createdAt: string;
};

type ConversionSourceArtifactBase = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
  storageKey: string;
  createdAt: string;
};

export type ConversionSourceArtifact =
  | ConversionSourceArtifactBase & {
    kind: 'original';
    document: null;
  }
  | ConversionSourceArtifactBase & {
    kind: 'normalized';
    document: StructuredSourceDocument;
  };

export type MigrationRunRecord = {
  id: string;
  batchId: string;
  batchPosition: number;
  purpose: 'recover_existing' | 'generate_new';
  createdBy: string;
  creatorEmail?: string | null;
  creatorName?: string | null;
  sourceFilename: string;
  sourceMime?: string | null;
  sourceSize: number;
  adapter: {
    id: string;
    label: string;
    version: string;
  };
  execution: MigrationExecutionState;
  approval: MigrationApprovalState;
  destination: MigrationDestination;
  summary: MigrationSummary;
  createdAt: string;
  updatedAt: string;
  parts: Array<Record<string, unknown>>;
  organizationGroups: ImportedOrganizationGroup[];
  reviewProgress: MigrationReviewProgress;
  items: MigrationItemRecord[];
  artifacts: ConversionSourceArtifact[];
};

export type ConversionPurpose = MigrationRunRecord['purpose'];

export type MigrationBatchProgress = {
  files: {
    total: number;
    queued: number;
    processing: number;
    analyzed: number;
    failed: number;
    committed: number;
  };
  assessments: {
    total: number;
    committed: number;
  };
  items: {
    total: number;
    ready: number;
    reviewNeeded: number;
    blocked: number;
    pendingReview: number;
    accepted: number;
    rejected: number;
  };
  assets: {
    recovered: number;
  };
  blockingFindings: {
    total: number;
    blockedItems: number;
    failedFiles: number;
  };
};

export type MigrationBatchRunSummary = Omit<
  MigrationRunRecord,
  'parts' | 'organizationGroups' | 'items' | 'artifacts' | 'reviewProgress'
>;

export type MigrationRunListItem = MigrationBatchRunSummary & {
  readonly reviewProgress: MigrationReviewProgress;
};

export type MigrationBatchRecord = {
  id: string;
  purpose: ConversionPurpose;
  createdBy: string;
  idempotencyKey: string;
  requestFingerprint: string;
  sourceCount: number;
  status: MigrationBatchStatus;
  assignedReviewerId: string | null;
  assignedReviewerName: string | null;
  assignedReviewerEmail: string | null;
  assignedBy: string | null;
  assignedAt: string | null;
  createdAt: string;
  updatedAt: string;
  progress: MigrationBatchProgress;
  runs: MigrationBatchRunSummary[];
};
