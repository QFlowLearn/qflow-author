import { useHydrated } from '../lib/client/use_hydrated.ts';
import { useEffect, useRef, useState } from 'preact/hooks';

import Button from '../components/ui/Button.tsx';
import Select from '../components/ui/Select.tsx';
import {
  type AssessmentBlueprint,
  assessmentBlueprintFormDraft,
} from '../lib/assessment_blueprint.ts';
import BlueprintEditorFields, {
  createStarterBlueprintFormDraft,
} from './BlueprintEditorFields.tsx';
import { I18nProvider, useI18n } from '../lib/i18n/context.tsx';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import { type I18n } from '../lib/i18n/messages.ts';

type GenerationState = 'idle' | 'starting' | 'running';
type GenerationFailureCode =
  | 'startFailed'
  | 'progressFailed'
  | 'failed'
  | 'timeout'
  | 'invalidDestination'
  | 'malformedResponse';

class GenerationClientError {
  constructor(readonly code: GenerationFailureCode) {}
}

type Props = {
  runId: string;
  initialBlueprint: AssessmentBlueprint;
  payload: I18nPayload;
};

export default function ConversionGeneration(props: Props) {
  return (
    <I18nProvider payload={props.payload}>
      <ConversionGenerationInner {...props} />
    </I18nProvider>
  );
}

function ConversionGenerationInner(
  { runId, initialBlueprint }: Omit<Props, 'payload'>,
) {
  const hydrated = useHydrated();
  const i18n = useI18n();
  const [state, setState] = useState<GenerationState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<GenerationFailureCode | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, [runId]);
  const [blueprint, setBlueprint] = useState(() =>
    initialBlueprint._tag === 'Defined'
      ? assessmentBlueprintFormDraft(initialBlueprint)
      : createStarterBlueprintFormDraft(i18n)
  );

  async function generate(event: SubmitEvent) {
    event.preventDefault();
    if (!hydrated || activeRequest.current || state !== 'idle') return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLFormElement)) {
      throw new Error('Generation submit requires its form.');
    }
    const form = new FormData(target);
    const request = new AbortController();
    activeRequest.current = request;
    const current = () => activeRequest.current === request && !request.signal.aborted;
    setState('starting');
    setError(null);
    let phase: 'start' | 'progress' = 'start';
    try {
      const response = await fetch(`/api/imports/${runId}/generate`, {
        method: 'POST',
        signal: request.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: form.get('mode'), blueprint }),
      });
      const payload = await readJson(response);
      if (!current()) return;
      if (!response.ok) throw new GenerationClientError('startFailed');
      if (!payload) throw new GenerationClientError('malformedResponse');
      const pollUrl = payload.pollUrl;
      if (typeof pollUrl !== 'string' || pollUrl.length === 0) {
        throw new GenerationClientError('malformedResponse');
      }
      if (!pollUrl.startsWith(`/api/imports/${runId}/generate/jobs/`)) {
        throw new GenerationClientError('invalidDestination');
      }
      setState('running');
      phase = 'progress';
      for (let attempt = 0; attempt < 300; attempt += 1) {
        await waitForPoll(request.signal);
        const progressResponse = await fetch(pollUrl, { signal: request.signal });
        if (!progressResponse.ok) throw new GenerationClientError('progressFailed');
        const progressPayload = await readJson(progressResponse);
        if (!current()) return;
        if (!progressPayload) throw new GenerationClientError('malformedResponse');
        const progress = progressPayload.progress;
        const status = progressPayload.status;
        if (typeof progress !== 'number' || !Number.isFinite(progress)) {
          throw new GenerationClientError('malformedResponse');
        }
        if (status !== 'running' && status !== 'completed' && status !== 'failed') {
          throw new GenerationClientError('malformedResponse');
        }
        setProgress(progress);
        if (status === 'completed') break;
        if (status === 'failed') throw new GenerationClientError('failed');
        if (attempt === 299) throw new GenerationClientError('timeout');
      }
      if (current()) location.reload();
    } catch (cause: unknown) {
      if (!current()) return;
      setState('idle');
      setError(
        cause instanceof GenerationClientError
          ? cause.code
          : phase === 'progress'
          ? 'progressFailed'
          : 'startFailed',
      );
    } finally {
      if (activeRequest.current === request) activeRequest.current = null;
    }
  }

  return (
    <form class='mx-auto max-w-4xl text-left' onSubmit={generate}>
      <fieldset disabled={!hydrated} class='min-w-0 space-y-6'>
        <BlueprintEditorFields
          value={blueprint}
          onChange={setBlueprint}
          allowedQuestionTypes={['single_select', 'multi_select', 'text_entry']}
        />
        <div class='max-w-xs'>
          <label class='flex flex-col gap-1'>
            <span class='text-xs font-medium'>{i18n.t('imports.generation.mode')}</span>
            <Select name='mode' value='fast'>
              <option value='fast'>{i18n.t('imports.generation.fast')}</option>
              <option value='thorough'>{i18n.t('imports.generation.thorough')}</option>
            </Select>
          </label>
        </div>
        {error && (
          <div class='ds-alert ds-alert-error text-sm' role='alert'>
            {generationFailureMessage(i18n, error)}
          </div>
        )}
        {state === 'running' && (
          <div class='space-y-2' role='status' aria-live='polite'>
            <progress class='ds-progress ds-progress-primary w-full' value={progress} max={100} />
            <p class='text-xs text-base-content/60'>
              {i18n.t('imports.generation.progress', { value: progress / 100 })}
            </p>
          </div>
        )}
        <p class='text-xs leading-5 text-base-content/65'>
          {i18n.t('imports.generation.policy')}{' '}
          <a class='ds-link' href='/help/portability'>
            {i18n.t('imports.generation.policyLink')}
          </a>.
        </p>
        <Button type='submit' variant='primary' disabled={state !== 'idle'}>
          {state === 'idle'
            ? i18n.t('imports.generation.generate')
            : i18n.t('imports.generation.starting')}
        </Button>
      </fieldset>
    </form>
  );
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const value: unknown = await response.json().catch(() => null);
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Maps a closed generation failure to localized UI copy. */
export function generationFailureMessage(
  i18n: I18n,
  code: GenerationFailureCode,
): string {
  switch (code) {
    case 'startFailed':
      return i18n.t('imports.generation.startFailed');
    case 'progressFailed':
      return i18n.t('imports.generation.progressFailed');
    case 'failed':
      return i18n.t('imports.generation.failed');
    case 'timeout':
      return i18n.t('imports.generation.timeout');
    case 'invalidDestination':
      return i18n.t('imports.generation.invalidDestination');
    case 'malformedResponse':
      return i18n.t('imports.generation.malformedResponse');
  }
}

/** The mounted generation request owns its polling timer and releases it on cancellation. */
function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((done, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      done();
    }, 1000);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
