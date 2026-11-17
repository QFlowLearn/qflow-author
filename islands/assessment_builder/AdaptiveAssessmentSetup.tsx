import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Select from '../../components/ui/Select.tsx';
import Input from '../../components/ui/Input.tsx';
import { BankEnrichmentFilters } from '../../components/item_bank/BankEnrichmentFilters.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import {
  type AdaptiveAssessmentPlan,
  type AdaptiveCoverage,
  adaptiveSettingsDocument,
  parseAdaptivePlan,
  parseAdaptiveSettings,
} from '../../lib/assessment_adaptive_plan.ts';
import {
  type AdaptiveCategoryOption,
  parseAdaptiveCoverage,
  parseAdaptiveOptions,
} from '../../lib/assessment_adaptive_response.ts';
import { useBankPicker } from './useBankPicker.ts';

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'failed' } | {
  kind: 'coverage';
  value: AdaptiveCoverage;
  key: string;
};

/** Only an explicit build changes membership. Retry retains the same command identifier. */
export default function AdaptiveAssessmentSetup(
  props: { assessmentId: string; plan?: AdaptiveAssessmentPlan; onCancel: () => void },
) {
  const i18n = useI18n();
  const picker = useBankPicker(
    props.plan ? adaptiveSettingsDocument(props.plan.settings).selection : '',
  );
  const [options, setOptions] = useState<
    { scheme: string; versions: readonly AdaptiveCategoryOption[] } | null
  >(null);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [versionId, setVersionId] = useState(props.plan?.settings.versionId ?? '');
  const [levelIds, setLevelIds] = useState<readonly string[]>(
    props.plan?.settings.levelIds ?? ['', '', ''],
  );
  const [count, setCount] = useState(String(props.plan?.settings.questionCount ?? 100));
  const [state, setState] = useState<State>({ kind: 'idle' });
  const request = useRef<{ key: string; id: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const scheme = picker.selection.enrichment?.schemeId ?? '';
  useEffect(() => {
    const controller = new AbortController();
    setOptions(null);
    setOptionsFailed(false);
    if (!scheme) return () => controller.abort();
    void (async () => {
      try {
        const response = await fetch(
          `/api/assessments/${props.assessmentId}/adaptive-plan?scheme=${
            encodeURIComponent(scheme)
          }`,
          { signal: controller.signal },
        );
        const versions = response.ok ? parseAdaptiveOptions(await response.json()) : null;
        if (!versions) throw new Error('Invalid category options.');
        if (!controller.signal.aborted) setOptions({ scheme, versions });
      } catch {
        if (!controller.signal.aborted) setOptionsFailed(true);
      }
    })();
    return () => controller.abort();
  }, [scheme, props.assessmentId]);
  useEffect(() => () => active.current?.abort(), []);
  const versions = options?.scheme === scheme ? options.versions : [];
  const version = versions.find((entry) => entry.id === versionId);
  const settings = version
    ? parseAdaptiveSettings({
      selection: picker.scope,
      versionId,
      levelIds,
      questionCount: Number(count),
    })
    : null;
  const key = settings ? JSON.stringify(adaptiveSettingsDocument(settings)) : '';
  const coverage = state.kind === 'coverage' && state.key === key ? state.value : null;
  const busy = state.kind === 'busy';
  const short = !coverage || coverage.levels.some((level) => level.available < level.required);
  async function submit(kind: 'inspect' | 'build') {
    if (!settings || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setState({ kind: 'busy' });
    if (kind === 'build' && request.current?.key !== key) {
      request.current = { key, id: crypto.randomUUID() };
    }
    const command = {
      kind,
      settings: adaptiveSettingsDocument(settings),
      ...(kind === 'build'
        ? { buildId: request.current?.id, expectedRevision: props.plan?.revision ?? 0 }
        : {}),
    };
    try {
      const response = await fetch(`/api/assessments/${props.assessmentId}/adaptive-plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
        signal: controller.signal,
      });
      const raw: unknown = await response.json();
      if (!response.ok || !raw || typeof raw !== 'object' || !('kind' in raw)) {
        throw new Error('Adaptive construction failed.');
      }
      if (controller.signal.aborted) return;
      if (raw.kind === 'built' && 'plan' in raw && parseAdaptivePlan(raw.plan)) {
        globalThis.location.assign(`/assessments/${props.assessmentId}`);
        return;
      }
      const value = 'coverage' in raw ? parseAdaptiveCoverage(raw.coverage) : null;
      if (!value || !['coverage', 'shortfall'].includes(String(raw.kind))) {
        throw new Error('Invalid coverage response.');
      }
      setState({ kind: 'coverage', value, key });
    } catch {
      if (!controller.signal.aborted) setState({ kind: 'failed' });
    } finally {
      active.current = null;
    }
  }
  return (
    <section class='space-y-4' aria-labelledby='adaptive-setup-heading' aria-busy={busy}>
      <h2 id='adaptive-setup-heading' class='text-lg font-semibold'>{i18n.t('adaptive.title')}</h2>
      <p class='text-sm text-base-content/80'>{i18n.t('adaptive.rule')}</p>
      <fieldset disabled={busy} class='space-y-4'>
        <label class='block space-y-1 text-sm'>
          <span>{i18n.t('items.collections.title')}</span>
          <Select
            value={picker.selection.collection}
            onChange={(event) => picker.change('collection', event.currentTarget.value)}
          >
            <option value=''>{i18n.t('items.collections.all')}</option>
            <option value='unfiled'>{i18n.t('items.collections.unfiled')}</option>
            {picker.result?.collections.map((collection) => (
              <option key={collection.id} value={collection.id}>{collection.name}</option>
            ))}
          </Select>
        </label>
        <div
          onChange={(event) => {
            const target = event.target;
            if (
              target instanceof HTMLSelectElement &&
              (target.name === 'scheme' || target.name === 'subject' || target.name === 'topic')
            ) picker.changeCategory(target.name, target.value);
          }}
        >
          <BankEnrichmentFilters
            ownership='component'
            view={picker.enrichment}
            filter={picker.selection.enrichment}
            i18n={i18n}
            dimensions={['subject', 'topic']}
            showStatuses={false}
          />
        </div>
        {picker.loading && <p role='status'>{i18n.t('adaptive.loading')}</p>}
        {(picker.error || optionsFailed) && <p role='alert'>{i18n.t('adaptive.failed')}</p>}
        {!picker.loading && !picker.enrichment.schemes.length && (
          <p>{i18n.t('adaptive.noCategories')}</p>
        )}
        {versions.length > 0 && (
          <label class='block space-y-1 text-sm'>
            <span id='adaptive-version-label'>
              {i18n.t('assessments.builder.proposal.version')}
            </span>
            <Select
              aria-labelledby='adaptive-version-label'
              value={versionId}
              onChange={(event) => {
                setVersionId(event.currentTarget.value);
                setLevelIds(['', '', '']);
              }}
            >
              <option value=''>{i18n.t('assessments.builder.proposal.chooseVersion')}</option>
              {versions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {i18n.t('assessments.builder.proposal.versionOption', {
                    version: entry.version,
                    audience: entry.audience,
                  })}
                </option>
              ))}
            </Select>
          </label>
        )}
        {version && (
          <div class='grid gap-3 sm:grid-cols-3'>
            {(['easiest', 'middle', 'hardest'] as const).map((position, index) => (
              <label key={position} class='space-y-1 text-sm'>
                <span id={`adaptive-${position}-label`}>{i18n.t(`adaptive.${position}`)}</span>
                <Select
                  aria-labelledby={`adaptive-${position}-label`}
                  value={levelIds[index]}
                  onChange={(event) =>
                    setLevelIds(
                      levelIds.map((id, offset) =>
                        offset === index ? event.currentTarget.value : id
                      ),
                    )}
                >
                  <option value=''>{i18n.t('adaptive.chooseLevel')}</option>
                  {version.levels.map((level) => (
                    <option
                      key={level.id}
                      value={level.id}
                      disabled={levelIds.some((id, offset) => offset !== index && id === level.id)}
                    >
                      {level.label}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
        )}
        <label class='block max-w-xs space-y-1 text-sm'>
          <span>{i18n.t('adaptive.length')}</span>
          <Input
            type='number'
            min={15}
            max={100}
            step={5}
            value={count}
            onInput={(event) => setCount(event.currentTarget.value)}
          />
        </label>
        {coverage && (
          <table class='ds-table ds-table-sm'>
            <caption class='sr-only'>{i18n.t('adaptive.coverage')}</caption>
            <thead>
              <tr>
                <th>{i18n.t('items.browse.difficulty')}</th>
                <th>{i18n.t('adaptive.required')}</th>
                <th>{i18n.t('adaptive.available')}</th>
              </tr>
            </thead>
            <tbody>
              {coverage.levels.map((level) => (
                <tr key={level.id}>
                  <th scope='row'>{level.label}</th>
                  <td>{level.required}</td>
                  <td>
                    {level.available}
                    {level.available < level.required && (
                      <span class='ml-2 text-error'>{i18n.t('adaptive.shortfall')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {props.plan && <p class='text-sm'>{i18n.t('adaptive.replace')}</p>}
        <div class='flex flex-wrap gap-2'>
          <Button
            type='button'
            disabled={!settings || picker.loading}
            onClick={() => void submit('inspect')}
          >
            {i18n.t('adaptive.check')}
          </Button>
          <Button
            type='button'
            variant='primary'
            disabled={!settings || short || picker.loading}
            onClick={() => void submit('build')}
          >
            {i18n.t(props.plan ? 'adaptive.rebuild' : 'adaptive.build')}
          </Button>
          <Button type='button' variant='text' onClick={props.onCancel}>
            {i18n.t('adaptive.cancel')}
          </Button>
        </div>
      </fieldset>
      {busy && <p role='status'>{i18n.t('adaptive.loading')}</p>}
      {state.kind === 'failed' && <p role='alert'>{i18n.t('adaptive.failed')}</p>}
    </section>
  );
}
