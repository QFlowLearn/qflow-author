import { uiEvent } from '../lib/client/ui_event.ts';
import { useHydrated } from '../lib/client/use_hydrated.ts';
import { useEffect, useRef, useState } from 'preact/hooks';

import Button from '../components/ui/Button.tsx';
import {
  type AssessmentBlueprint,
  type AssessmentBlueprintCoverage,
  assessmentBlueprintFormDraft,
  parseAssessmentBlueprint,
} from '../lib/assessment_blueprint.ts';
import { QUESTION_TYPE_IDS, type QuestionTypeId } from '../lib/types/registry.ts';
import BlueprintEditorFields, {
  createStarterBlueprintFormDraft,
} from './BlueprintEditorFields.tsx';
import { I18nProvider, useI18n } from '../lib/i18n/context.tsx';
import type { I18nPayload } from '../lib/i18n/payload.ts';

type Props = {
  readonly resource: 'assessment' | 'conversion';
  readonly resourceId: string;
  readonly initialBlueprint: AssessmentBlueprint;
  readonly coverage?: AssessmentBlueprintCoverage;
  readonly allowedQuestionTypes?: readonly QuestionTypeId[];
  readonly readOnly?: boolean;
  readonly onSaved?: (blueprint: AssessmentBlueprint) => void;
  readonly payload: I18nPayload;
};

/** Saved blueprint editor with visible coverage for assessments and conversion runs. */
export default function BlueprintPanel({
  payload,
  ...props
}: Props) {
  return (
    <I18nProvider payload={payload}>
      <BlueprintPanelInner {...props} />
    </I18nProvider>
  );
}

function BlueprintPanelInner({
  resource,
  resourceId,
  initialBlueprint,
  coverage,
  allowedQuestionTypes = QUESTION_TYPE_IDS,
  readOnly = false,
  onSaved,
}: Omit<Props, 'payload'>) {
  const hydrated = useHydrated();
  const i18n = useI18n();
  const [savedBlueprint, setSavedBlueprint] = useState(initialBlueprint);
  const [blueprint, setBlueprint] = useState(() =>
    initialBlueprint._tag === 'Defined'
      ? assessmentBlueprintFormDraft(initialBlueprint)
      : createStarterBlueprintFormDraft(i18n)
  );
  const [editing, setEditing] = useState(
    !readOnly && initialBlueprint._tag === 'Unspecified',
  );
  const [state, setState] = useState<'idle' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, [resource, resourceId]);

  async function save() {
    if (!hydrated || activeRequest.current || state !== 'idle') return;
    const request = new AbortController();
    activeRequest.current = request;
    const current = () => activeRequest.current === request && !request.signal.aborted;
    setState('saving');
    setError(null);
    try {
      const base = resource === 'assessment' ? '/api/assessments' : '/api/imports';
      const response = await fetch(`${base}/${resourceId}/blueprint`, {
        method: 'PUT',
        signal: request.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(blueprint),
      });
      const payload = await readJson(response);
      if (!current()) return;
      if (!response.ok) {
        setState('idle');
        setError(i18n.t('imports.blueprint.saveFailed'));
        return;
      }
      const saved = parseAssessmentBlueprint(payload.blueprint);
      setSavedBlueprint(saved);
      setEditing(false);
      setState('idle');
      if (onSaved) onSaved(saved);
      else location.reload();
    } catch {
      if (!current()) return;
      setState('idle');
      setError(i18n.t('imports.blueprint.saveFailed'));
    } finally {
      if (activeRequest.current === request) activeRequest.current = null;
    }
  }

  return (
    <section
      class='rounded-xl border border-base-300 bg-base-100 p-4 sm:p-5'
      aria-labelledby='assessment-plan-heading'
    >
      <div class='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 id='assessment-plan-heading' class='text-lg font-semibold'>
            {i18n.t('imports.blueprint.title')}
          </h2>
          <p class='mt-1 max-w-3xl text-sm leading-6 text-base-content/65'>
            {i18n.t('imports.blueprint.description')}
          </p>
        </div>
        {!readOnly && !editing && (
          <Button
            type='button'
            size='sm'
            disabled={!hydrated}
            onClick={() => setEditing(true)}
          >
            {i18n.t('imports.blueprint.edit')}
          </Button>
        )}
      </div>

      {!editing && savedBlueprint._tag === 'Defined' && (
        <div class='mt-4 space-y-3'>
          <div class='grid gap-2 sm:grid-cols-3'>
            <Metric
              label={i18n.t('imports.blueprint.outcomes')}
              value={i18n.formatNumber(savedBlueprint.outcomes.length)}
            />
            <Metric
              label={i18n.t('imports.blueprint.targets')}
              value={i18n.formatNumber(
                savedBlueprint.targets.reduce((sum, target) => sum + target.count, 0),
              )}
            />
            <Metric
              label={i18n.t('imports.blueprint.coverage')}
              value={coverage
                ? i18n.t('imports.blueprint.coverageRatio', {
                  assigned: coverage.assigned,
                  expected: coverage.expected,
                })
                : i18n.t('imports.blueprint.notMeasured')}
            />
          </div>
          {coverage && !coverage.complete && (
            <div
              class='rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm'
              role='status'
            >
              {i18n.t('imports.blueprint.incomplete')}
            </div>
          )}
          {coverage?.complete && (
            <div
              class='rounded-lg border border-success/40 bg-success/10 p-3 text-sm'
              role='status'
            >
              {i18n.t('imports.blueprint.complete')}
            </div>
          )}
          <ul class='divide-y divide-base-200 rounded-lg border border-base-300 text-sm'>
            {savedBlueprint.targets.map((target) => {
              const targetCoverage = coverage?.targets.find((entry) => entry.id === target.id);
              const outcome = savedBlueprint.outcomes.find((entry) =>
                entry.id === target.outcomeId
              );
              return (
                <li key={target.id} class='flex flex-wrap items-center justify-between gap-2 p-3'>
                  <span>
                    <span class='font-medium'>
                      {outcome?.title ?? i18n.t('imports.blueprint.unknownOutcome')}
                    </span>
                    <span class='ml-2 text-base-content/60'>
                      {i18n.t('imports.blueprint.targetSummary', {
                        type: i18n.t('imports.blueprint.typeLabel', { type: target.questionType }),
                        demand: i18n.t('imports.blueprint.demandLabel', {
                          value: target.cognitiveDemand,
                        }),
                        difficulty: i18n.t('imports.blueprint.difficultyLabel', {
                          value: target.difficulty,
                        }),
                        count: target.count,
                      })}
                    </span>
                  </span>
                  <span class='font-medium'>
                    {targetCoverage
                      ? i18n.t('imports.blueprint.coverageRatio', {
                        assigned: targetCoverage.actual,
                        expected: target.count,
                      })
                      : i18n.formatNumber(target.count)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!editing && savedBlueprint._tag === 'Unspecified' && (
        <p class='mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm'>
          {i18n.t('imports.blueprint.noPlan')}
        </p>
      )}

      {editing && !readOnly && (
        <fieldset disabled={!hydrated} class='mt-5 min-w-0 space-y-5'>
          <BlueprintEditorFields
            value={blueprint}
            onChange={setBlueprint}
            allowedQuestionTypes={allowedQuestionTypes}
          />
          {error && <div class='ds-alert ds-alert-error text-sm' role='alert'>{error}</div>}
          <div class='flex flex-wrap gap-2'>
            <Button
              type='button'
              variant='primary'
              disabled={state === 'saving'}
              onClick={uiEvent(save)}
            >
              {state === 'saving'
                ? i18n.t('imports.blueprint.saving')
                : i18n.t('imports.blueprint.save')}
            </Button>
            {savedBlueprint._tag === 'Defined' && (
              <Button
                type='button'
                variant='ghost'
                onClick={() => {
                  setBlueprint(savedBlueprint);
                  setEditing(false);
                }}
              >
                {i18n.t('imports.blueprint.cancel')}
              </Button>
            )}
          </div>
          {state === 'saving' && (
            <p class='text-sm text-base-content/65' role='status' aria-live='polite'>
              {i18n.t('imports.blueprint.saving')}
            </p>
          )}
        </fieldset>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div class='rounded-lg border border-base-300 p-3'>
      <div class='text-xs text-base-content/70'>{label}</div>
      <div class='mt-1 text-lg font-semibold'>{value}</div>
    </div>
  );
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
