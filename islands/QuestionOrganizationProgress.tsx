import { ORGANIZATION_QUESTION_LIMIT } from '../lib/organization_limits.ts';
import Select from '../components/ui/Select.tsx';
import SafeHtml from '../components/ui/SafeHtml.tsx';
import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import { BankAlert } from '../components/item_bank/ui.tsx';
import { createI18n } from '../lib/i18n/messages.ts';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import type { OrganizationProgress } from '../lib/services/question_organization_workspace.ts';
import { submitEnrichmentAction } from '../lib/bank_enrichment_client.ts';

/** A bounded sample and completion summary, with explicit controls for later automatic work. */
export default function QuestionOrganizationProgress(
  props: { run: OrganizationProgress; operationId: string; payload: I18nPayload },
) {
  const { run } = props, i18n = createI18n(props.payload.locale, props.payload.namespaces);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const disabled = !hydrated || busy;
  const [undoProcessed, setUndoProcessed] = useState(run.undoProcessed);
  const [corrections, setCorrections] = useState<Readonly<Record<string, string>>>({});
  const teachingRequest = useRef<{ key: string; id: string } | null>(null);
  const lessons = run.sample.flatMap((item) =>
    corrections[item.questionId]
      ? [{
        questionId: item.questionId,
        revisionId: item.revisionId,
        topicId: corrections[item.questionId],
      }]
      : []
  );
  async function saveLessons() {
    const key = JSON.stringify(lessons);
    if (!teachingRequest.current || teachingRequest.current.key !== key) {
      teachingRequest.current = { key, id: crypto.randomUUID() };
    }
    await send('organization-teach-preview', {
      operationId: teachingRequest.current.id,
      corrections: lessons,
    });
  }
  const pending = useRef(false),
    request = useRef<AbortController | null>(null),
    errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => setHydrated(true), []);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!['queued', 'undoing'].includes(run.state)) return;
    const request = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(location.href, {
          headers: { Accept: 'application/json' },
          signal: request.signal,
        });
        const raw: unknown = await response.json();
        if (
          typeof raw === 'object' && raw !== null && 'state' in raw &&
          raw.state !== run.state
        ) {
          location.reload();
          return;
        }
        if (
          typeof raw === 'object' && raw !== null && 'undoProcessed' in raw &&
          typeof raw.undoProcessed === 'number' && Number.isSafeInteger(raw.undoProcessed) &&
          raw.undoProcessed >= 0 && raw.undoProcessed <= ORGANIZATION_QUESTION_LIMIT
        ) {
          setUndoProcessed(raw.undoProcessed);
        }
      } catch { /* A temporary polling failure leaves the explicit refresh control available. */ }
      if (!request.signal.aborted) timer = setTimeout(refresh, 3000);
    }
    timer = setTimeout(refresh, 3000);
    return () => {
      request.abort();
      clearTimeout(timer);
    };
  }, [run.id, run.state, run.undoProcessed]);
  async function send(action: string, fields: Record<string, unknown> = {}) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    request.current = new AbortController();
    const result = await submitEnrichmentAction(location.href, { action, ...fields }, {
      signal: request.current.signal,
    });
    if (request.current.signal.aborted) return;
    if (result && 'url' in result) {
      location.assign(result.url);
      return;
    }
    setError(result && 'error' in result ? result.error : i18n.t('items.organize.errorNetwork'));
    pending.current = false;
    setBusy(false);
  }
  return (
    <div class='space-y-5'>
      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <BankAlert tone='error'>{error}</BankAlert>
        </div>
      )}
      <p role='status' class='text-lg font-medium'>
        {i18n.t(`items.organization.state.${run.state}`)}
      </p>
      <p>
        {i18n.t(
          run.mode === 'preview'
            ? 'items.organization.previewHelp'
            : 'items.organization.applyHelp',
        )}
      </p>
      {['undoing', 'undo_failed'].includes(run.state) && (
        <p role='status'>
          {i18n.t('items.organization.undoProgress', {
            done: undoProcessed,
            total: run.counts.reduce((sum, c) => sum + c.count, 0),
          })}
        </p>
      )}
      {run.state === 'undoing' && <p>{i18n.t('items.organization.undoHelp')}</p>}
      {!['undone', 'undoing', 'undo_failed'].includes(run.state) && (
        <dl class='flex flex-wrap gap-6'>
          {run.counts.map((c) => (
            <div key={c.state}>
              <dt>{i18n.t(`items.organization.state.${c.state}`)}</dt>
              <dd>{i18n.formatNumber(c.count)}</dd>
            </div>
          ))}
        </dl>
      )}
      {run.recovery.count > 0 && <p>{i18n.t('items.organization.resumeHelp')}</p>}
      {run.recovery.budgetBlocked > 0 && <p>{i18n.t('items.organization.resumeBudget')}</p>}
      <div class='flex flex-wrap gap-3'>
        {run.mode === 'apply' && ['completed', 'failed', 'cancelled'].includes(run.state) && (
          <Button
            href={`/items/organize/${run.id}?kind=organization&download=summary`}
            variant='default'
          >
            {i18n.t('items.organization.report.download')}
          </Button>
        )}
        {run.recovery.count > 0 && (
          <Button
            type='button'
            variant='primary'
            disabled={disabled}
            onClick={() => send('organization-resume', { expectedExecutionId: run.executionId })}
          >
            {i18n.t('items.organize.resume')}
          </Button>
        )}
        {run.state === 'queued' && (
          <>
            <Button
              type='button'
              variant='default'
              disabled={disabled}
              onClick={() => send('organization-cancel')}
            >
              {i18n.t('items.organize.cancel')}
            </Button>
            <Button href={`/items/organize/${run.id}?kind=organization`} variant='ghost'>
              {i18n.t('items.organization.refresh')}
            </Button>
          </>
        )}
        {run.mode === 'preview' && run.state === 'completed' && (
          <Button
            type='button'
            variant='primary'
            disabled={disabled || lessons.length > 0}
            onClick={() => send('organization-apply')}
          >
            {i18n.t('items.organization.apply')}
          </Button>
        )}
        {run.state === 'undoing' && (
          <Button href={`/items/organize/${run.id}?kind=organization`} variant='ghost'>
            {i18n.t('items.organization.refresh')}
          </Button>
        )}
        {run.mode === 'apply' &&
          ['completed', 'failed', 'cancelled', 'undo_failed'].includes(run.state) && (
          <Button
            type='button'
            variant='default'
            disabled={disabled}
            onClick={() => send('organization-undo', { expectedExecutionId: run.executionId })}
          >
            {i18n.t(
              run.state === 'undo_failed' ? 'items.organization.resumeUndo' : 'items.organize.undo',
            )}
          </Button>
        )}
        <Button
          href={`/items/organize?scope=${encodeURIComponent('collection=' + run.collectionId)}`}
          variant='ghost'
        >
          {i18n.t('items.organization.editRules')}
        </Button>
        <Button href={`/items?collection=${run.collectionId}`} variant='ghost'>
          {i18n.t('items.organization.openCollection')}
        </Button>
      </div>
      {!['queued', 'undoing'].includes(run.state) && (
        <section class='space-y-3 border-t border-base-300 pt-4'>
          <h2 class='font-semibold'>{i18n.t('items.organization.future')}</h2>
          <p>
            {i18n.t(
              run.activation.setupId ? 'items.organization.enabled' : 'items.organization.disabled',
            )}
          </p>
          <Button
            type='button'
            variant='default'
            disabled={disabled || lessons.length > 0}
            onClick={() =>
              send('organization-activation', {
                operationId: props.operationId,
                collectionId: run.collectionId,
                expectedRevision: run.activation.revision,
                setupId: run.activation.setupId === run.setupId ? null : run.setupId,
              })}
          >
            {i18n.t(
              run.activation.setupId === run.setupId
                ? 'items.organization.disable'
                : 'items.organization.enable',
            )}
          </Button>
        </section>
      )}
      <section class='space-y-3'>
        <h2 class='font-semibold'>
          {i18n.t(
            ['undoing', 'undo_failed', 'undone'].includes(run.state)
              ? 'items.organization.beforeUndo'
              : 'items.organization.sample',
          )}
        </h2>
        {run.mode === 'preview' && run.state !== 'queued' && (
          <p>
            {i18n.t('items.organization.sampleScope', {
              shown: run.sample.length,
              inspected: run.counts.reduce((sum, c) => sum + c.count, 0),
            })}
          </p>
        )}
        {run.sample.some((s) => s.canTeach) && <p>{i18n.t('items.organization.teachingHelp')}</p>}
        {run.mode === 'preview' && run.definition.examples.length > 0 && (
          <p>{i18n.t('items.organize.teachingSaved', { count: run.definition.examples.length })}</p>
        )}
        <form
          method='post'
          action={`/items/organize/${run.id}?kind=organization`}
          onSubmit={(event) => {
            event.preventDefault();
            if (lessons.length) return saveLessons();
          }}
        >
          <ul class='divide-y divide-base-300'>
            {run.sample.map((s) => (
              <li key={s.questionId} class='space-y-2 py-4'>
                <div class='flex flex-wrap justify-between gap-3'>
                  <span class='font-medium'>{s.title}</span>
                  <span>
                    {s.topic ?? i18n.t(`items.organization.state.${s.state}`)}
                    {s.destination ? ` → ${s.destination}` : ''}
                  </span>
                </div>
                {s.sampleReason && (
                  <p>{i18n.t(`items.organization.sampleReason.${s.sampleReason}`)}</p>
                )}
                {s.content && (
                  <details>
                    <summary class='cursor-pointer'>
                      {i18n.t('items.organization.viewQuestion')}
                    </summary>
                    <div class='space-y-2 pt-2'>
                      <SafeHtml html={s.content.body} />
                      <ol>
                        {s.content.choices.map((c) => (
                          <li key={c.id}>
                            {c.html ? <SafeHtml html={c.html} /> : c.text}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </details>
                )}
                {s.canTeach && (
                  <details>
                    <summary>{i18n.t('items.organization.correctTopic')}</summary>
                    <label for={`topic-${s.questionId}`}>
                      {i18n.t('items.organization.correctTopicLabel')}
                    </label>
                    <Select
                      id={`topic-${s.questionId}`}
                      name={`topic-${s.questionId}`}
                      disabled={disabled}
                      value={corrections[s.questionId] ?? ''}
                      onChange={(event) =>
                        setCorrections((current) => ({
                          ...current,
                          [s.questionId]: event.currentTarget.value,
                        }))}
                    >
                      <option value=''>{i18n.t('items.organization.keepPrediction')}</option>
                      {run.definition.topics.map((topic) => (
                        <option key={topic.id} value={topic.id}>{topic.label}</option>
                      ))}
                    </Select>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {lessons.length > 0 && (
            <div>
              <p role='status'>
                {i18n.t('items.organization.pendingLessons', { count: lessons.length })}
              </p>
              <Button type='submit' variant='primary' disabled={disabled}>
                {i18n.t('items.organization.saveLessons')}
              </Button>
              <Button
                type='button'
                variant='ghost'
                disabled={disabled}
                onClick={() => setCorrections({})}
              >
                {i18n.t('items.organization.discardLessons')}
              </Button>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
