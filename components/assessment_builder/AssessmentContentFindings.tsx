import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import Button from '../ui/Button.tsx';
import {
  type AssessmentContentFinding,
  assessmentQuestionAnchor,
} from '../../lib/assessment_content.ts';
import { useI18n } from '../../lib/i18n/context.tsx';

/** A closed-by-default, advisory disclosure; dismissal lasts for this builder visit only. */
export default function AssessmentContentFindings(
  { findings }: { readonly findings: readonly AssessmentContentFinding[] },
) {
  const i18n = useI18n();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const summaryRef = useRef<HTMLElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const dismiss = (key: string) => {
    moveFocus.current = true;
    setDismissed((current) => new Set([...current, key]));
  };
  const undo = () => {
    moveFocus.current = true;
    setDismissed(new Set());
  };
  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (summaryRef.current ?? emptyRef.current?.querySelector('button'))?.focus();
  }, [dismissed]);
  const [showAll, setShowAll] = useState(false);
  const firstRevealedRef = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    if (showAll) firstRevealedRef.current?.focus();
  }, [showAll]);
  const visible = findings.filter((finding) => !dismissed.has(finding.key));
  const hasDismissed = findings.some((finding) => dismissed.has(finding.key));
  if (findings.length === 0) return null;
  if (visible.length === 0) {
    return (
      <div ref={emptyRef} class='flex flex-wrap items-center gap-2 text-sm'>
        <span>{i18n.t('assessments.findings.hidden')}</span>
        <Button variant='ghost' size='sm' onClick={undo}>
          {i18n.t('assessments.findings.undo')}
        </Button>
      </div>
    );
  }
  return (
    <details class='text-sm' data-assessment-findings>
      <summary
        ref={summaryRef}
        class='w-fit cursor-pointer rounded-sm py-1 text-base-content underline decoration-base-content/30 underline-offset-4 focus-visible:outline focus-visible:outline-2'
      >
        {i18n.t('assessments.findings.count', { count: visible.length })}
      </summary>
      <div class='mt-2 rounded-lg border border-base-300 bg-base-100 p-4'>
        <p class='max-w-prose text-base-content/80'>{i18n.t('assessments.findings.scope')}</p>
        <ul class='mt-3 divide-y divide-base-200'>
          {(showAll ? visible : visible.slice(0, 5)).map((finding, index) => (
            <li
              key={finding.key}
              ref={index === 5 ? firstRevealedRef : undefined}
              tabIndex={-1}
              class='py-3 first:pt-0'
            >
              <p class='font-medium'>
                {i18n.t('assessments.findings.question', { number: finding.number })} ·{' '}
                {i18n.t(`assessments.findings.${finding.kind}.title`)}
              </p>
              <p class='mt-1 break-words text-base-content/80'>{finding.title}</p>
              <p class='mt-1 max-w-prose'>
                {i18n.t(`assessments.findings.${finding.kind}.detail`)}
              </p>
              <div class='mt-2 flex flex-wrap gap-2'>
                <Button
                  href={`#${assessmentQuestionAnchor(finding.placementId)}`}
                  size='sm'
                >
                  {i18n.t('assessments.findings.go')}
                </Button>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => dismiss(finding.key)}
                >
                  {i18n.t('assessments.findings.dismiss')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <div class='flex flex-wrap gap-2'>
          {!showAll && visible.length > 5 && (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setShowAll(true)}
            >
              {i18n.t('assessments.findings.showAll', { count: visible.length })}
            </Button>
          )}
          {hasDismissed && (
            <Button variant='ghost' size='sm' onClick={undo}>
              {i18n.t('assessments.findings.undo')}
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}
