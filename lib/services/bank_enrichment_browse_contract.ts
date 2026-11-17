import type { EnrichmentDimension, EnrichmentValue } from './bank_enrichment_contract.ts';
import type { BankEnrichmentValueFilter } from './bank_enrichment_query.ts';
import type { QuestionBankPage, QuestionBankSummary } from './question_bank_read.ts';

/** One explicitly chosen vocabulary, with audience taken from its latest version. */
export type EnrichmentBrowseScheme = {
  readonly id: string;
  readonly versionId: string;
  readonly version: number;
  readonly name: string;
  readonly audience: string;
};
/** Facets retain producing versions, including labels removed by subsequent edits. */
export type EnrichmentBrowseCategory = {
  readonly versionId: string;
  readonly version: number;
  readonly audience: string;
  readonly id: string;
  readonly label: string;
  readonly count: number;
};
/** Missing values distinguish untouched questions from unfinished classification. */
export type EnrichmentBrowseValue =
  | { readonly state: 'pending' | 'outside' }
  | {
    readonly state: 'classified';
    readonly value: EnrichmentValue;
    readonly versionId: string;
    readonly categories: readonly { readonly id: string; readonly label: string }[];
    readonly version: number;
    readonly audience: string;
    readonly outdated: boolean;
  };
/** Alternative counts preserve all other bank filters; topic counts may overlap. */
export type EnrichmentBrowseFacet = {
  readonly categories: readonly EnrichmentBrowseCategory[];
  readonly truncated: boolean;
  readonly unassigned: number;
  readonly pending: number;
  readonly outside: number;
  readonly outdated: number;
};
/** Optional, separately loaded classifications leave ordinary bank/picker contracts unchanged. */
export type EnrichmentBrowseView = {
  readonly schemes: readonly EnrichmentBrowseScheme[];
  readonly schemesTruncated: boolean;
  readonly selection: {
    readonly scheme: EnrichmentBrowseScheme;
    readonly facets: Readonly<Record<EnrichmentDimension, EnrichmentBrowseFacet>>;
  } | null;
};

/** Only question-list projections carry per-question classifications. */
export type EnrichmentQuestionsView = Omit<EnrichmentBrowseView, 'selection'> & {
  readonly selection:
    | (NonNullable<EnrichmentBrowseView['selection']> & {
      readonly rows: Readonly<
        Record<string, Readonly<Record<EnrichmentDimension, EnrichmentBrowseValue>>>
      >;
    })
    | null;
};

/** An overview selection always carries its matrix, never question rows. */
export type EnrichmentOverviewView = Omit<EnrichmentBrowseView, 'selection'> & {
  readonly selection:
    | (NonNullable<EnrichmentBrowseView['selection']> & {
      readonly overview: EnrichmentOverview;
    })
    | null;
};

/** The page mode determines exactly which bank and classification projection is available. */
export type EnrichmentBankPage =
  | {
    readonly kind: 'questions';
    readonly bank: QuestionBankPage;
    readonly enrichment: EnrichmentQuestionsView;
  }
  | {
    readonly kind: 'overview';
    readonly bank: QuestionBankSummary;
    readonly enrichment: EnrichmentOverviewView;
  };

/** A versioned category or explicit missing state, with its exact drill-down filter. */
export type EnrichmentOverviewBucket = {
  readonly key: string;
  readonly filter: BankEnrichmentValueFilter;
  readonly category:
    | { readonly label: string; readonly version: number; readonly audience: string }
    | null;
};

/** Counts for one difficulty row, shared by subject and topic groups. */
export type EnrichmentOverviewCounts = {
  readonly counts: readonly number[];
  readonly total: number;
};
export type EnrichmentOverviewRow = EnrichmentOverviewCounts & {
  readonly bucket: EnrichmentOverviewBucket;
};

/** Whole-selection matrix. Rows and columns partition the scope, including missing values. */
export type EnrichmentOverview = {
  readonly columns: readonly EnrichmentOverviewBucket[];
  readonly rows: readonly (EnrichmentOverviewRow & {
    readonly topics: readonly EnrichmentOverviewRow[];
  })[];
  readonly totals: readonly number[];
  readonly total: number;
  readonly statuses: readonly {
    readonly dimension: EnrichmentDimension;
    readonly kind: 'unassigned' | 'pending' | 'outside' | 'outdated';
    readonly count: number;
  }[];
};
