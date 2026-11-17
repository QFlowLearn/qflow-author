import type { QuestionPointEditingAuthority } from '../../lib/question_point_authority.ts';
import type { QuestionPreview } from '../../lib/question_preview.ts';
import type { Draft } from '../../lib/types/draft.ts';
import type { QuestionTypeId } from '../../lib/types/registry.ts';
import type { AssessmentBlueprint } from '../../lib/assessment_blueprint.ts';
import type { AdaptiveAssessmentPlan } from '../../lib/assessment_adaptive_plan.ts';
import type { QuestionReviewSuggestion } from '../../lib/question_review_types.ts';
import type { PartOptions } from '../../lib/test_export.ts';
import type {
  AssessmentContentPlacement,
  AssessmentStandaloneContent,
} from '../../lib/assessment_standalone_content.ts';

export type { QuestionPreview };

export type QuestionPlacement = {
  id: string;
  itemId: string;
  snapshotRev?: number;
  blueprintTargetId?: string;
  fixed?: boolean;
};

export type Placement = QuestionPlacement | AssessmentContentPlacement;

export type Part = { id: string; title: string; placements: Placement[]; options?: PartOptions };

export type ItemMeta = {
  readonly id: string;
  readonly itemId: string;
  readonly title: string;
  readonly latestRev: number;
  readonly questionTypeId: QuestionTypeId;
  readonly questionType: string;
  readonly preview: QuestionPreview;
  readonly blueprintTargetId?: string;
  readonly reviewSuggestions: readonly QuestionReviewSuggestion[];
};

export type DeliverySummary = {
  assessmentVersionId: string;
  previewUrl?: string;
  adminUrl?: string;
  publishedAt: string;
};

export type AssessmentView = {
  adaptivePlan?: AdaptiveAssessmentPlan;
  id: string;
  title: string;
  parts: Part[];
  brief?: string;
  gradeLevel?: string;
  targetCount?: number;
  attachmentId?: string | null;
  delivery?: DeliverySummary | null;
  blueprint: AssessmentBlueprint;
};

/** The only legal authoring states for the continuous assessment builder. */
export type AuthoringState =
  | { readonly _tag: 'Idle' }
  | {
    readonly _tag: 'CreatingContent';
    readonly initialDraft: AssessmentStandaloneContent;
    readonly partId: string;
    readonly beforePlacementId?: string;
    readonly placementId: string;
  }
  | {
    readonly _tag: 'EditingContent';
    readonly partId: string;
    readonly placement: AssessmentContentPlacement;
  }
  | {
    readonly _tag: 'Creating';
    readonly textAssistance?: true;
    readonly initialDraft?: Draft;
    readonly beforePlacementId?: string;
    readonly type: QuestionTypeId;
    readonly partId: string;
  }
  | {
    readonly _tag: 'Editing';
    /** Exact loaded revision; advances only after the authoring save succeeds. */
    readonly revision: number;
    readonly pointEditingAuthority: QuestionPointEditingAuthority;
    readonly itemId: string;
    readonly placementId: string;
    readonly partId: string;
    readonly draft: Draft;
  };

export type ItemActionBusy = 'variant' | 'export' | 'delete' | 'restore' | 'deliveryPublish' | null;
