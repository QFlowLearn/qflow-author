import { summarizeAdaptiveRoute } from '../../lib/assessment_adaptive_route_summary.ts';
import { useState } from 'preact/hooks';
import { assessmentQuestionAnchor } from '../../lib/assessment_content.ts';
import Button from '../../components/ui/Button.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { AssessmentView, ItemMeta } from './types.ts';
import AdaptiveAnswerPreview from './AdaptiveAnswerPreview.tsx';
import AdaptiveAssessmentSetup from './AdaptiveAssessmentSetup.tsx';
import BankQuestionPreview, { type BankPreviewContext } from './BankQuestionPreview.tsx';
import { adaptivePoolCounts } from '../../lib/assessment_adaptive_plan.ts';

export type AdaptiveCanvasProps = BankPreviewContext & {
  assessment: AssessmentView;
  items: Record<string, ItemMeta>;
  onSetupChange?: (open: boolean) => void;
};

/** Frozen alternatives are grouped and loaded on demand, never shown as a 285-card form. */
export default function AdaptiveAssessmentCanvas(props: AdaptiveCanvasProps) {
  const i18n = useI18n(), plan = props.assessment.adaptivePlan;
  const [answering, setAnswering] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [setup, setSetup] = useState(!plan);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ answered: number; levels: readonly string[] } | null>(
    null,
  );
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<
    'strong' | 'struggling' | 'mixed' | null
  >(null);
  if (setup) {
    return (
      <AdaptiveAssessmentSetup
        assessmentId={props.assessment.id}
        plan={plan}
        onCancel={() => {
          setSetup(false);
          props.onSetupChange?.(false);
        }}
      />
    );
  }
  if (!plan) {
    return (
      <section class='border-t border-base-300 pt-4'>
        <Button
          onClick={() => {
            setSetup(true);
            props.onSetupChange?.(true);
          }}
        >
          {i18n.t('adaptive.title')}
        </Button>
      </section>
    );
  }
  if (answering) {
    return (
      <AdaptiveAnswerPreview
        assessment={props.assessment}
        payload={props.payload}
        playerCatalog={props.playerCatalog}
        onClose={() => {
          setAnswering(false);
          requestAnimationFrame(() => document.getElementById('answer-draft-button')?.focus());
        }}
      />
    );
  }
  const counts = adaptivePoolCounts(plan.settings.questionCount);
  async function simulate(scenario: 'strong' | 'struggling' | 'mixed') {
    setPreviewBusy(true);
    setPreviewFailed(false);
    setPreview(null);
    setSelectedScenario(null);
    try {
      const response = await fetch(
        `/api/assessments/${props.assessment.id}/adaptive-preview?scenario=${scenario}`,
      );
      const raw: unknown = await response.json();
      if (
        !response.ok || !raw || typeof raw !== 'object' || !('answered' in raw) ||
        typeof raw.answered !== 'number' || !('levels' in raw) || !Array.isArray(raw.levels) ||
        !raw.levels.every((level): level is string => typeof level === 'string')
      ) throw new Error('Invalid preview.');
      setPreview({ answered: raw.answered, levels: raw.levels });
      setSelectedScenario(scenario);
    } catch {
      setPreviewFailed(true);
      setPreview(null);
      setSelectedScenario(null);
    } finally {
      setPreviewBusy(false);
    }
  }
  return (
    <section class='space-y-5' aria-labelledby='adaptive-heading'>
      <div class='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 id='adaptive-heading' class='text-lg font-semibold'>
            {i18n.t('adaptive.questionsHeading')}
          </h2>
          <p class='mt-1'>
            {i18n.t('adaptive.summary', {
              count: plan.settings.questionCount,
              pool: counts.reduce((a, b) => a + b, 0),
            })}
          </p>
        </div>
        <Button
          onClick={() => {
            setSetup(true);
            props.onSetupChange?.(true);
          }}
        >
          {i18n.t('adaptive.editSetup')}
        </Button>
      </div>
      <div class='max-w-prose space-y-2 text-sm text-base-content/80'>
        <p>{i18n.t('adaptive.rule')}</p>
        <p>{plan.audience}</p>
      </div>
      <p class='text-sm text-base-content/80'>
        {i18n.t('adaptive.poolExplanation', { count: plan.settings.questionCount })}
      </p>
      <div class='mt-3 divide-y divide-base-300'>
        {plan.levels.map((level, index) => (
          <details key={level.id} class='py-3'>
            <summary class='cursor-pointer py-2 font-medium'>
              {i18n.t('adaptive.poolLevel', { level: level.label, count: counts[index] })}
            </summary>
            <ul class='divide-y divide-base-200'>
              {plan.blocks.filter((block) => block.level === index).flatMap((block) =>
                block.placementIds
              ).map((id) => {
                const placement = props.assessment.parts[0].placements.find((entry) =>
                    entry.id === id
                  ),
                  meta = props.items[id];
                if (!placement || !('itemId' in placement) || !placement.snapshotRev || !meta) {
                  throw new Error('Pinned adaptive question is missing.');
                }
                return (
                  <li
                    key={id}
                    id={assessmentQuestionAnchor(id)}
                    tabIndex={-1}
                    class='py-2'
                    style={{ scrollMarginTop: '5rem' }}
                  >
                    <Button
                      variant='text'
                      aria-expanded={expanded === id}
                      onClick={() => setExpanded(expanded === id ? null : id)}
                    >
                      {meta.title}
                    </Button>
                    {expanded === id && (
                      <BankQuestionPreview
                        itemId={placement.itemId}
                        revision={placement.snapshotRev}
                        payload={props.payload}
                        playerCatalog={props.playerCatalog}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>

      <details
        open={previewOpen}
        onToggle={(event) => setPreviewOpen(event.currentTarget.open)}
        id='assessment-preview'
        class='border-t border-base-300 pt-3'
      >
        <summary class='cursor-pointer py-2 text-lg font-semibold'>
          {i18n.t('adaptive.previewAssessment')}
        </summary>
        <div class='space-y-5 pt-3 pb-5'>
          <div class='grid gap-6 lg:grid-cols-2'>
            <div>
              <h3 class='font-semibold'>{i18n.t('adaptive.draftPreviewHeading')}</h3>
              <p class='mt-1 mb-3 max-w-prose text-sm text-base-content/80'>
                {i18n.t('adaptive.answerDescription')}
              </p>
              <Button id='answer-draft-button' variant='primary' onClick={() => setAnswering(true)}>
                {i18n.t('adaptive.answer')}
              </Button>
            </div>
            {props.assessment.delivery?.previewUrl && (
              <div>
                <h3 class='font-semibold'>{i18n.t('adaptive.publishedPreviewHeading')}</h3>
                <p class='mt-1 mb-3 max-w-prose text-sm text-base-content/80'>
                  {i18n.t('adaptive.publishedPreviewDescription')}
                </p>
                <Button
                  href={props.assessment.delivery.previewUrl}
                  target='_blank'
                  rel='noreferrer'
                >
                  {i18n.t('list.builder.header.launch')}
                </Button>
              </div>
            )}
          </div>
          <details class='border-t border-base-300 pt-2'>
            <summary class='cursor-pointer py-2 font-medium'>{i18n.t('adaptive.simulate')}</summary>
            <p class='mt-1 mb-3 max-w-prose text-sm text-base-content/80'>
              {i18n.t('adaptive.simulateDescription')}
            </p>
            <div class='flex flex-wrap gap-2'>
              {(['strong', 'struggling', 'mixed'] as const).map((scenario) => (
                <Button
                  key={scenario}
                  disabled={previewBusy}
                  aria-pressed={selectedScenario === scenario}
                  variant={selectedScenario === scenario ? 'primary' : 'default'}
                  onClick={() => void simulate(scenario)}
                >
                  {i18n.t(`adaptive.${scenario}`)}
                </Button>
              ))}
            </div>
            {previewBusy && <p role='status' class='mt-3'>{i18n.t('adaptive.loading')}</p>}
            {previewFailed && <p role='alert' class='mt-3'>{i18n.t('adaptive.failed')}</p>}
            {preview && (
              <section aria-labelledby='adaptive-simulation-result-heading' class='mt-4'>
                <h3 id='adaptive-simulation-result-heading' class='font-semibold'>
                  {i18n.t('adaptive.simulationResult')}
                </h3>
                <p role='status' class='mt-1 text-sm text-base-content/80'>
                  {i18n.t('adaptive.simulationCount', { count: preview.answered })}
                </p>
                <ol class='mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm'>
                  {summarizeAdaptiveRoute(preview.levels).map((segment) => (
                    <li key={segment.start}>{i18n.t('adaptive.blockRange', segment)}</li>
                  ))}
                </ol>
                <details class='mt-3'>
                  <summary class='cursor-pointer py-2 text-sm'>
                    {i18n.t('adaptive.allBlocks')}
                  </summary>
                  <ol class='mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4'>
                    {preview.levels.map((level, index) => (
                      <li key={index}>
                        {i18n.t('adaptive.blockRange', {
                          start: index * 5 + 1,
                          end: index * 5 + 5,
                          level,
                        })}
                      </li>
                    ))}
                  </ol>
                </details>
              </section>
            )}
          </details>
        </div>
      </details>
    </section>
  );
}
