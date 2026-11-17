import { mountIsland } from '../../lib/rendering/mount_island.ts';
import LocalizedTimestampView from '../../islands/LocalizedTimestamp.tsx';
import type { ComponentChildren } from 'preact';
import type {
  QuestionCompatibilityOutcome,
  QuestionReviewFacetState,
} from '../../lib/question_bank.ts';
import type { I18n } from '../../lib/i18n/messages.ts';

const REVIEW_STATE_PRESENTATION = {
  not_requested: {
    tone: 'border-base-300 bg-base-200/50',
  },
  open: {
    tone: 'border-base-300 bg-base-200/50',
  },
  approved: {
    tone: 'border-success/35 bg-success/10 text-success',
  },
  changes_requested: {
    tone: 'border-warning/40 bg-warning/10',
  },
} as const satisfies Record<
  QuestionReviewFacetState,
  { readonly tone: string }
>;

const COMPATIBILITY_OUTCOME_TONES = {
  exact: 'text-success',
  normalized: 'text-base-content/70',
  lossy: 'text-warning',
  blocked: 'text-warning',
} as const satisfies Record<QuestionCompatibilityOutcome, string>;

export function BankAlert(
  props: { readonly tone: 'success' | 'error'; readonly children: ComponentChildren },
) {
  return (
    <div
      role={props.tone === 'error' ? 'alert' : 'status'}
      class={`rounded-lg border px-4 py-3 text-sm ${
        props.tone === 'error' ? 'border-error/35 bg-error/10' : 'border-success/35 bg-success/10'
      }`}
    >
      {props.children}
    </div>
  );
}

export function BankBadge({ children }: { readonly children: ComponentChildren }) {
  return (
    <span class='rounded-md border border-base-300 bg-base-200/50 px-1.5 py-0.5 text-xs'>
      {children}
    </span>
  );
}

export function BankField(
  props: {
    readonly label: string;
    readonly class?: string;
    readonly children: ComponentChildren;
  },
) {
  return (
    <label class={`ds-form-control gap-1 ${props.class ?? ''}`}>
      <span class='text-xs font-medium text-base-content/70'>{props.label}</span>
      {props.children}
    </label>
  );
}

export function ReviewStateBadge(
  { state, i18n }: { readonly state: QuestionReviewFacetState; readonly i18n: I18n },
) {
  const presentation = REVIEW_STATE_PRESENTATION[state];
  const label = i18n.t(
    {
      not_requested: 'items.review.notReviewed',
      open: 'items.review.inReview',
      approved: 'items.review.approved',
      changes_requested: 'items.review.changesRequested',
    }[state],
  );
  return (
    <span
      class={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${presentation.tone}`}
    >
      {label}
    </span>
  );
}

export function formatBankDate(value: string, i18n: I18n) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return i18n.t('items.shared.unavailable');
  return <LocalizedTimestamp value={date.toISOString()} locale={i18n.locale} />;
}

export function compatibilityOutcomeTone(outcome: QuestionCompatibilityOutcome): string {
  return COMPATIBILITY_OUTCOME_TONES[outcome];
}

const LocalizedTimestamp = mountIsland({
  component: 'LocalizedTimestamp',
  View: LocalizedTimestampView,
});
