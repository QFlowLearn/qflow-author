import type { Placement as AssessmentPlacement } from '../assessment_builder/types.ts';
export type Placement = AssessmentPlacement;
export type Part = {
  id: string;
  title: string;
  placements: Placement[];
  options?: {
    shuffleQuestions?: boolean;
    navigationMode?: 'linear' | 'nonlinear';
    submissionMode?: 'individual' | 'simultaneous';
    timeLimits?: { minTime?: number; maxTime?: number };
    instructionsHtml?: string;
    feedback?: Array<{
      id: string;
      access: 'during' | 'atEnd';
      showHide: 'show' | 'hide';
      outcomeIdentifier: string;
      html: string;
    }>;
  };
};

export const ITEM_ROW_BASE =
  'group flex items-center gap-3 rounded-md border border-base-200/70 bg-base-100 px-2 py-2 text-sm transition hover:border-base-200 hover:bg-base-100';
export const ITEM_ROW_ACTIVE = 'border-primary/60 bg-primary/5';
export const PART_CARD =
  'ds-card ds-card-bordered border-base-200/70 bg-base-100 shadow-none rounded-[10px]';
