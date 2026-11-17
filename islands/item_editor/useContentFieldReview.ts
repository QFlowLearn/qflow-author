import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import type { ContentReviewField, ContentReviewRequest } from './context.ts';

const TARGETS = {
  maximumScore: '[data-editor-field="maximumScore"] input',
  body: '[data-editor-field="body"] [contenteditable="true"]',
  prompt: '[data-editor-field="prompt"]',
  choices:
    '[data-choice-content] textarea, [data-choice-content] [contenteditable="true"], [data-editor-field="choices"]',
  correct:
    '[data-choice-selection] input, [data-choice-selection] select, [data-editor-field="correct"]',
  matchSources: '[data-editor-field="matchSources"]',
  matchTargets: '[data-editor-field="matchTargets"]',
  matchPairs: '[data-editor-field="matchPairs"]',
  order: '[data-editor-field="order"]',
  textEntry: '[data-editor-field="textEntry"]',
} satisfies Record<ContentReviewField, string>;

/** Focus a requested canvas control after content/driver mounting, cancelling on departure. */
export function useContentFieldReview(
  root: RefObject<HTMLElement>,
  request: ContentReviewRequest | null,
  finish: (sequence: number) => void,
) {
  useEffect(() => {
    const container = root.current;
    if (!container || !request) return;
    const selector = TARGETS[request.field];
    let observer: MutationObserver | undefined;
    let completed = false;
    const complete = () => {
      completed = true;
      observer?.disconnect();
      finish(request.sequence);
    };
    const focus = () => {
      if (completed) return;
      const target = container.querySelector<HTMLElement>(selector);
      if (!target || target.closest('[hidden]')) return;
      complete();
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'center', behavior: 'instant' });
    };
    const cancelForNewFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (event.target.matches(selector)) return;
      if (event.target.matches('input, textarea, select, [contenteditable="true"]')) complete();
    };
    container.addEventListener('focusin', cancelForNewFocus);
    const frame = requestAnimationFrame(() => {
      focus();
      if (completed) return;
      observer = new MutationObserver(focus);
      observer.observe(container, { childList: true, subtree: true });
    });
    return () => {
      completed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      container.removeEventListener('focusin', cancelForNewFocus);
    };
  }, [request, root, finish]);
}
