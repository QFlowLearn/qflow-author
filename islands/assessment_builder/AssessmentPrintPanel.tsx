import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../../components/ui/Button.tsx';
import Input from '../../components/ui/Input.tsx';
import Select from '../../components/ui/Select.tsx';
import Textarea from '../../components/ui/Textarea.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { PrintConfiguration, PrintPreflight } from '../../lib/print/print_contract.ts';
import type { PrintPackView } from '../../lib/print/print_view.ts';
import {
  parsePrintPackView,
  parsePrintPreflight,
  printBase,
  printRequest,
  requestPrintPreview,
} from '../../lib/client/assessment_print.ts';
import PrintPdfPreview from './PrintPdfPreview.tsx';

/** One paper workflow beside the existing destinations, with explicit review before finalization. */
export default function AssessmentPrintPanel(
  { assessmentId, revisionFingerprint, onRepairPrint }: {
    readonly assessmentId: string;
    readonly revisionFingerprint: string;
    readonly onRepairPrint?: (placementId: string) => void;
  },
) {
  const i18n = useI18n();
  const [configuration, setConfiguration] = useState<PrintConfiguration>({
    title: '',
    paper: 'a4',
    locale: i18n.locale,
    instructions: '',
    responseLines: 6,
    responseOverrides: {},
    order: 'authored',
    approvePresentation: false,
  });
  const [pack, setPack] = useState<PrintPackView | null>(null),
    [history, setHistory] = useState<readonly PrintPackView[]>([]),
    [preflight, setPreflight] = useState<PrintPreflight | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [kind, setKind] = useState<'student' | 'marking'>('student'),
    [reviewed, setReviewed] = useState<readonly string[]>([]),
    [acknowledged, setAcknowledged] = useState(false);
  const [writtenPlacements, setWrittenPlacements] = useState<PrintPreflight['items']>([]);
  const operation = useRef<string | null>(null), version = useRef(revisionFingerprint);
  const base = printBase(assessmentId),
    pending = pack?.state === 'preparing' || pack?.state === 'queued' || pack?.state === 'building';
  const editable = !busy && !pending;
  const change = (patch: Partial<PrintConfiguration>) => {
    setConfiguration((previous) => ({ ...previous, ...patch }));
    setPack(null);
    setPreflight(null);
    setReviewed([]);
    setAcknowledged(false);
    operation.current = null;
    setError('');
  };
  useEffect(() => {
    if (version.current === revisionFingerprint) return;
    version.current = revisionFingerprint;
    setPack(null);
    setPreflight(null);
    setReviewed([]);
    setAcknowledged(false);
    operation.current = null;
    setError('stale_preview');
  }, [revisionFingerprint]);
  useEffect(() => {
    const controller = new AbortController();
    printRequest(base, undefined, controller.signal).then((value) => {
      if (!Array.isArray(value)) throw Error('invalid_response');
      const parsed = value.map(parsePrintPackView);
      if (parsed.some((value) => !value)) throw Error('invalid_response');
      if (!controller.signal.aborted) setHistory(parsed.filter((value) => value !== null));
    }).catch(() => {
      if (!controller.signal.aborted) setError('request_failed');
    });
    return () => controller.abort();
  }, [base]);
  useEffect(() => {
    if (!pack || !pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = parsePrintPackView(
          await printRequest(`${base}/${pack.id}`, undefined, controller.signal),
        );
        if (!next) throw Error('invalid_response');
        if (controller.signal.aborted) return;
        setPack(next);
        if (['preparing', 'queued', 'building'].includes(next.state)) {
          timer = setTimeout(poll, 1500);
        }
      } catch {
        if (!controller.signal.aborted) setError('request_failed');
      }
    };
    timer = setTimeout(poll, 500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [pack?.id, pending]);
  const run = async (action: 'inspect' | 'preview' | 'confirm') => {
    setBusy(true);
    setError('');
    try {
      if (action === 'inspect') {
        const result = parsePrintPreflight(
          await printRequest(`${base}/preflight`, { configuration }),
        );
        if (!result) throw Error('invalid_response');
        setPreflight(result);
        setWrittenPlacements(result.items.filter((finding) => finding.responseSpace));
      } else if (action === 'preview') {
        operation.current ??= crypto.randomUUID();
        const result = await requestPrintPreview(assessmentId, operation.current, configuration);
        setPreflight(result.preflight);
        setWrittenPlacements(result.preflight.items.filter((finding) => finding.responseSpace));
        setPack(result.pack);
        setReviewed([]);
        setAcknowledged(false);
      } else {
        if (!pack?.confirmation || !acknowledged || reviewed.length !== 2) throw Error('not_ready');
        const final = parsePrintPackView(
          await printRequest(`${base}/${pack.id}/confirm`, pack.confirmation),
        );
        if (!final) throw Error('invalid_response');
        setPack(final);
        setHistory((items) => [final, ...items.filter((item) => item.id !== final.id)]);
      }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  };
  const visible = pack?.state === 'preview-ready' || pack?.state === 'confirmed';
  return (
    <section class='mt-5 space-y-5' aria-labelledby='print-heading'>
      <h3 id='print-heading' class='text-lg font-semibold'>{i18n.t('print.destination')}</h3>
      <div class='grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]'>
        <div class='min-w-0 space-y-5'>
          {!visible && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run('preview');
              }}
            >
              <fieldset disabled={!editable} class='space-y-4'>
                <div>
                  <label for='paper-title' class='flex items-center justify-between py-2'>
                    {i18n.t('print.title')}
                  </label>
                  <Input
                    id='paper-title'
                    name='title'
                    value={configuration.title}
                    maxLength={160}
                    required
                    onInput={(event) => change({ title: event.currentTarget.value })}
                  />
                </div>
                <div>
                  <label for='paper-instructions' class='flex items-center justify-between py-2'>
                    {i18n.t('print.instructions')}
                  </label>
                  <Textarea
                    id='paper-instructions'
                    name='instructions'
                    rows={4}
                    maxLength={4000}
                    value={configuration.instructions}
                    onInput={(event) => change({ instructions: event.currentTarget.value })}
                  />
                </div>
                <label class='flex items-start gap-3'>
                  <input
                    class='ds-checkbox mt-1'
                    type='checkbox'
                    name='approvePresentation'
                    checked={configuration.approvePresentation}
                    onChange={(event) =>
                      change({ approvePresentation: event.currentTarget.checked })}
                  />
                  <span>{i18n.t('print.approvePresentation')}</span>
                </label>
                <div class='flex flex-wrap gap-3'>
                  <Button type='button' onClick={() => void run('inspect')}>
                    {i18n.t('print.check')}
                  </Button>
                  <Button type='submit' variant='primary'>{i18n.t('print.createPreview')}</Button>
                </div>
              </fieldset>
            </form>
          )}
          <div role='status' aria-live='polite'>
            {busy && i18n.t('print.loading')}
            {pending && i18n.t('print.building')}
            {pack?.state === 'preview-ready' && <p>{i18n.t('print.draftPreview')}</p>}
            {pack?.state === 'failed' && (
              <p class='text-error'>
                {i18n.t(
                  pack.failureCode === 'font_unsupported'
                    ? 'print.fontUnsupported'
                    : 'print.buildFailed',
                )}
              </p>
            )}
            {pack?.state === 'confirmed' && (
              <p class='font-medium'>{i18n.t('print.confirmed', { form: pack.form })}</p>
            )}
          </div>
          {pack?.state === 'failed' && (
            <Button
              type='button'
              onClick={() => {
                operation.current = null;
                setPack(null);
              }}
            >
              {i18n.t('print.newForm')}
            </Button>
          )}
          {error && (
            <p role='alert' class='text-error'>
              {i18n.t(
                error === 'stale_preview'
                  ? 'print.stale'
                  : error === 'forbidden'
                  ? 'print.forbidden'
                  : 'print.requestFailed',
              )}
            </p>
          )}
          {preflight && (
            <div>
              <h4 class='font-semibold'>
                {i18n.t(
                  preflight.outcome === 'ready'
                    ? 'print.ready'
                    : preflight.outcome === 'blocked'
                    ? 'print.blocked'
                    : 'print.adaptation',
                )}
              </h4>
              <ol class='mt-2 divide-y divide-base-300'>
                {preflight.items.map((finding) => (
                  <li key={finding.placementId} class='py-3'>
                    <div class='flex flex-wrap justify-between gap-2'>
                      <span>{finding.title || i18n.t('print.content')}</span>
                      <span>
                        {i18n.t(
                          finding.outcome === 'Ready'
                            ? 'print.ready'
                            : finding.outcome === 'Blocked'
                            ? 'print.blocked'
                            : 'print.adaptation',
                        )}
                      </span>
                    </div>
                    {finding.codes.map((code) => (
                      <p class='mt-1 text-sm' key={code}>{i18n.t(printIssueKey(code))}</p>
                    ))}
                    {finding.outcome === 'Blocked' && (
                      <Button
                        size='sm'
                        variant='text'
                        type='button'
                        onClick={() => onRepairPrint?.(finding.placementId)}
                      >
                        {i18n.t('print.repair')}
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {visible && pack && (
            <div class='space-y-4'>
              <div role='group' aria-label={i18n.t('print.documentKind')} class='flex gap-2'>
                {(['student', 'marking'] as const).map((value) => (
                  <Button
                    type='button'
                    key={value}
                    aria-pressed={kind === value}
                    variant={kind === value ? 'primary' : 'default'}
                    onClick={() => setKind(value)}
                  >
                    {i18n.t(`print.${value}`)}
                  </Button>
                ))}
              </div>
              <PrintPdfPreview
                key={`${pack.id}-${kind}`}
                url={`${base}/${pack.id}/preview/${kind}`}
                onReviewed={() =>
                  setReviewed((previous) =>
                    previous.includes(kind) ? previous : [...previous, kind]
                  )}
              />
              {pack.state === 'preview-ready' && (
                <div class='space-y-3'>
                  <label class='flex items-start gap-3'>
                    <input
                      type='checkbox'
                      class='ds-checkbox mt-1'
                      checked={acknowledged}
                      disabled={reviewed.length !== 2}
                      onChange={(event) => setAcknowledged(event.currentTarget.checked)}
                    />
                    <span>{i18n.t('print.confirmReview')}</span>
                  </label>
                  <Button
                    type='button'
                    variant='primary'
                    disabled={busy || !acknowledged || reviewed.length !== 2}
                    onClick={() => void run('confirm')}
                  >
                    {i18n.t('print.finalize')}
                  </Button>
                </div>
              )}
              {pack.state === 'confirmed' && (
                <div class='flex flex-wrap gap-3'>
                  {(['student', 'marking', 'manifest'] as const).map((value) => (
                    <Button key={value} href={`${base}/${pack.id}/${value}`} download>
                      {i18n.t(`print.download.${value}`)}
                    </Button>
                  ))}
                </div>
              )}
              <Button
                type='button'
                onClick={() => {
                  setPack(null);
                  setReviewed([]);
                  setAcknowledged(false);
                  operation.current = null;
                }}
              >
                {i18n.t('print.newForm')}
              </Button>
            </div>
          )}
        </div>
        <aside class='space-y-5 border-t border-base-300 pt-4 lg:border-s lg:border-t-0 lg:ps-5 lg:pt-0'>
          <fieldset disabled={!editable || visible} class='space-y-4'>
            <legend class='mb-3 font-semibold'>{i18n.t('print.settings')}</legend>
            <fieldset>
              <legend class='mb-2 text-sm'>{i18n.t('print.paper')}</legend>
              <div class='flex gap-4'>
                {(['a4', 'letter'] as const).map((paper) => (
                  <label key={paper} class='flex items-center gap-2'>
                    <input
                      type='radio'
                      name='paper'
                      value={paper}
                      checked={configuration.paper === paper}
                      onChange={() => change({ paper })}
                    />
                    {paper === 'a4' ? 'A4' : 'Letter'}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label class='flex items-center justify-between py-2' for='paper-lines'>
                {i18n.t('print.responseLines')}
              </label>
              <Input
                id='paper-lines'
                name='responseLines'
                type='number'
                min={3}
                max={18}
                value={configuration.responseLines}
                onInput={(event) => change({ responseLines: event.currentTarget.valueAsNumber })}
              />
            </div>
            <div>
              <label class='flex items-center justify-between py-2' for='paper-locale'>
                {i18n.t('print.labelsLanguage')}
              </label>
              <Select
                id='paper-locale'
                name='locale'
                value={configuration.locale}
                onChange={(event) => {
                  const locale = event.currentTarget.value;
                  if (
                    locale === 'en-US' || locale === 'en-GB' || locale === 'sv-SE' ||
                    locale === 'es-ES' || locale === 'es-419'
                  ) change({ locale });
                }}
              >
                {[
                  ['en-US', 'English (US)'],
                  ['en-GB', 'English (UK)'],
                  ['es-ES', 'Español (España)'],
                  ['es-419', 'Español (Latinoamérica)'],
                  ['sv-SE', 'Svenska'],
                ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </div>
            {writtenPlacements.map((finding) => (
              <div key={finding.placementId}>
                <label
                  class='flex items-center justify-between py-2'
                  for={`paper-lines-${finding.placementId}`}
                >
                  {finding.title || i18n.t('print.content')}
                </label>
                <Input
                  id={`paper-lines-${finding.placementId}`}
                  name={`response-${finding.placementId}`}
                  type='number'
                  min={3}
                  max={18}
                  value={configuration.responseOverrides[finding.placementId] ??
                    configuration.responseLines}
                  onInput={(event) =>
                    change({
                      responseOverrides: {
                        ...configuration.responseOverrides,
                        [finding.placementId]: event.currentTarget.valueAsNumber,
                      },
                    })}
                />
              </div>
            ))}
          </fieldset>
          {history.length > 0 && (
            <div>
              <h4 class='font-semibold'>{i18n.t('print.history')}</h4>
              <ul class='mt-2 space-y-2'>
                {history.map((item) => (
                  <li key={item.id}>
                    <Button
                      type='button'
                      size='sm'
                      variant='text'
                      onClick={() => {
                        setConfiguration(item.configuration);
                        operation.current = item.operationId;
                        setPack(item);
                        setReviewed([]);
                        setAcknowledged(false);
                      }}
                    >
                      {item.form}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function printIssueKey(code: string): string {
  if (code === 'approve_paper_presentation') return 'print.approvePresentation';
  if (code === 'marking_guidance_required') return 'print.issue.manualGuidance';
  if (code.startsWith('image_')) {
    return code === 'image_orientation'
      ? 'print.issue.orientation'
      : code === 'image_animation'
      ? 'print.issue.animation'
      : code === 'image_color'
      ? 'print.issue.color'
      : 'print.issue.image';
  }
  if (code.includes('scoring') || code.includes('rubric')) return 'print.issue.scoring';
  if (code.includes('timing')) return 'print.issue.timing';
  if (code.includes('adaptive') || code.includes('linear')) return 'print.issue.sequence';
  if (code.includes('math')) return 'print.issue.math';
  if (code.includes('limit') || code.includes('depth')) return 'print.issue.limit';
  return 'print.issue.content';
}
