import type { QflowDatabase } from '../db.ts';
import type {
  ClefOrganizationConfig,
  ClefOrganizationProvider,
} from '../ai/clef_organization_provider.ts';
import type { organizationItems } from '../db/question_organization_schema.ts';
import type { OrganizationDecision } from './question_organization_decision.ts';
import type { EnrichmentQuestion } from './bank_enrichment_input.ts';

export type OrganizationWorkerServices = {
  readonly database: QflowDatabase;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly provider: (config: ClefOrganizationConfig) => ClefOrganizationProvider;
};

export type ClaimedItem = {
  readonly item: typeof organizationItems.$inferSelect;
  readonly leaseToken: string;
  readonly decision: OrganizationDecision | null;
  readonly reservation: number;
};

export type ItemOutcome =
  | {
    readonly kind: 'decision';
    readonly value: OrganizationDecision;
    readonly chargedMicros: number;
  }
  | { readonly kind: 'failure'; readonly code: string }
  | { readonly kind: 'received' };
export type PreparedWork = ItemOutcome | {
  readonly kind: 'inference';
  readonly question: EnrichmentQuestion;
  readonly teaching: readonly { readonly question: EnrichmentQuestion; readonly topicId: string }[];
};
