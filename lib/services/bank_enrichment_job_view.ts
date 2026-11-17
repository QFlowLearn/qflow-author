import type { EnrichmentPreviewResult } from './bank_enrichment_preview_codec.ts';
import type { EnrichmentRunProgress } from './bank_enrichment_progress.ts';
import type { PrepareEnrichmentRun } from './bank_enrichment_run_contract.ts';
import type { EnrichmentSample } from './bank_enrichment_sample.ts';
import type { EnrichmentUsageSummary } from './bank_enrichment_usage.ts';

type JobIdentity = {
  readonly id: string;
  readonly snapshotId: string;
  readonly scopeCount: number;
  readonly capturedAt: string;
  readonly updatedAt: string;
};
/** Task kind distinguishes AI analysis from human corrections and compensating undo. */
export type EnrichmentJobRecord =
  & JobIdentity
  & (
    | {
      readonly kind: 'preview';
      readonly baseVersionId: string | null;
      readonly state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
      readonly phase: 'propose' | 'measure';
      readonly audience: string;
      readonly sample: EnrichmentSample | null;
      readonly result: EnrichmentPreviewResult | null;
      readonly errorCode: string | null;
    }
    | {
      readonly kind: 'classify';
      readonly state:
        | 'queued'
        | 'running'
        | 'completed'
        | 'completed_with_issues'
        | 'failed'
        | 'cancelled';
      readonly schemeId: string;
      readonly errorCode: string | null;
      readonly command: PrepareEnrichmentRun;
      readonly progress: EnrichmentRunProgress;
    }
    | {
      readonly kind: 'correct' | 'undo';
      readonly state:
        | 'queued'
        | 'running'
        | 'completed'
        | 'completed_with_issues'
        | 'failed'
        | 'cancelled';
      readonly schemeId: string;
      readonly sourceRunId: string | null;
      readonly errorCode: string | null;
      readonly command: PrepareEnrichmentRun;
      readonly progress: EnrichmentRunProgress;
      readonly teachingExampleCount: number | null;
      readonly changes: {
        readonly questions: number;
        readonly dimensions: number;
        readonly laterEdits: number;
        readonly noChanges: number;
      };
    }
  );
/** Reloadable status carries user-facing results; provider diagnostics stay in the audit records. */
export type EnrichmentJobView =
  | (Extract<EnrichmentJobRecord, { kind: 'preview' | 'classify' }> & {
    readonly usage: EnrichmentUsageSummary;
  })
  | (Extract<EnrichmentJobRecord, { kind: 'correct' | 'undo' }> & { readonly usage: null });
