import { uiEvent } from '../lib/client/ui_event.ts';
import type { SourceIntakeDestination } from '../lib/source_intake/entry_context.ts';
import { useEffect, useRef, useState } from 'preact/hooks';
import Button from '../components/ui/Button.tsx';
import FileDropzone from '../components/ui/FileDropzone.tsx';
import Radio from '../components/ui/Radio.tsx';
import Textarea from '../components/ui/Textarea.tsx';
import type {
  SourceAdapterRef,
  SourceCandidate,
  SourceInspection,
  SourcePurpose,
} from '../lib/source_intake/registry.ts';
import type { SourceEntry } from '../lib/source_intake/entry_context.ts';
import {
  GENERATION_SOURCE_ACCEPT,
  RECOVERY_SOURCE_ACCEPT,
  RESPONDUS_SOURCE_ACCEPT,
} from '../lib/source_intake/source_catalog.ts';
import { isCanonicalUuid } from '../lib/uuid.ts';
import {
  MAX_GENERATION_FILE_BYTES,
  MAX_SOURCE_BATCH_BYTES,
  MAX_SOURCE_FILES,
  MAX_SOURCE_TEXT_CHARS,
} from '../lib/source_intake/policy.ts';
import { I18nProvider, useI18n } from '../lib/i18n/context.tsx';
import type { I18nPayload } from '../lib/i18n/payload.ts';
import {
  adapterLabel,
  inspectionReasonMessage,
  LocalizedIntakeFailure,
  parseSourceInspectionResponse,
  parseSourceIntakeFailureEnvelope,
  sourceIntakeFailureMessage,
} from './source_intake/contract.ts';
export {
  parseSourceInspectionResponse,
  parseSourceIntakeFailureEnvelope,
  sourceIntakeFailureMessage,
} from './source_intake/contract.ts';

type SourceMethod = 'files' | 'paste';
type RequestState = 'idle' | 'inspecting' | 'executing';
export type {
  SourceIntakeFailure,
  SourceIntakeFailureCodeClient,
} from './source_intake/contract.ts';

type Props = {
  readonly destination: SourceIntakeDestination;
  readonly initialPurpose?: SourcePurpose;
  readonly entrySource?: SourceEntry;
  readonly payload: I18nPayload;
};

const SUBMISSION_KEY_STORAGE = 'qflow.source-intake.submission-key.v2';

/** Unified source-intake workflow for recovery and AI generation. */
export default function BringFilesIntake(
  { payload, ...props }: Props,
) {
  return (
    <I18nProvider payload={payload}>
      <BringFilesIntakeContent {...props} />
    </I18nProvider>
  );
}

function BringFilesIntakeContent(
  { initialPurpose = 'recover_existing', entrySource, destination }: Omit<Props, 'payload'>,
) {
  const i18n = useI18n();
  const storageKey = `${SUBMISSION_KEY_STORAGE}:${
    destination._tag === 'Assessment'
      ? 'assessment'
      : `bank:${destination.collectionId ?? 'unfiled'}`
  }`;
  const isRespondusEntry = entrySource === 'respondus';
  const [hydrated, setHydrated] = useState(false);
  const [purpose, setPurpose] = useState<SourcePurpose>(initialPurpose);
  const [method, setMethod] = useState<SourceMethod>('files');
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [inspections, setInspections] = useState<readonly SourceInspection[] | null>(null);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submissionKey, setSubmissionKey] = useState<string>(() => crypto.randomUUID());
  const firstFileSelection = useRef(true);
  const requestInFlight = useRef(false);

  useEffect(() => {
    setHydrated(true);
    const restored = readStoredSubmissionKey(storageKey);
    if (restored) setSubmissionKey(restored);
  }, []);

  useEffect(() => {
    storeSubmissionKey(storageKey, submissionKey);
  }, [submissionKey]);

  const canInspect = method === 'files' ? files.length > 0 : text.trim().length > 0;
  const canContinue = inspections !== null && inspections.length > 0 &&
    inspections.every((inspection, index) =>
      inspection._tag === 'resolved' ||
      (inspection._tag === 'confirmation_required' && Boolean(selections[index]))
    );

  function resetInspection(options: { readonly rotateSubmission?: boolean } = {}): void {
    setInspections(null);
    setSelections({});
    setFeedback(null);
    if (options.rotateSubmission ?? true) setSubmissionKey(crypto.randomUUID());
  }

  function rotateSubmissionKey(): void {
    clearStoredSubmissionKey(storageKey);
    setSubmissionKey(crypto.randomUUID());
  }

  function changePurpose(next: SourcePurpose): void {
    if (destination._tag === 'WorkspaceBank' && next !== 'recover_existing') return;
    setPurpose(next);
    if (next === 'generate_new' && files.length > 1) setFiles(files.slice(0, 1));
    resetInspection({ rotateSubmission: true });
  }

  function changeMethod(next: SourceMethod): void {
    setMethod(next);
    resetInspection({ rotateSubmission: true });
  }

  function buildPayload(): FormData {
    const form = new FormData();
    form.set('purpose', purpose);
    form.set('destination', destination._tag);
    if (destination._tag === 'WorkspaceBank' && destination.collectionId !== null) {
      form.set('collectionId', destination.collectionId);
    }
    if (method === 'files') {
      files.forEach((file) => form.append('files', file));
    } else {
      form.set('text', text);
    }
    inspections?.forEach((inspection, index) => {
      const candidate = selectedCandidate(inspection, selections[index]);
      if (candidate) form.set(`adapter-${index}`, adapterKey(candidate.adapter));
    });
    return form;
  }

  async function inspect(): Promise<void> {
    if (!canInspect || requestInFlight.current) return;
    requestInFlight.current = true;
    setRequestState('inspecting');
    setFeedback(null);
    try {
      const response = await fetch('/api/source-intake/inspect', {
        method: 'POST',
        body: buildPayload(),
      });
      const payload = await readJsonRecord(response);
      if (!response.ok) {
        const failure = parseSourceIntakeFailureEnvelope(payload);
        if (!failure) throw new Error('malformed');
        throw new LocalizedIntakeFailure(sourceIntakeFailureMessage(i18n, failure));
      }
      const parsed = parseSourceInspectionResponse(payload);
      if (!parsed) throw new Error('malformed');
      setInspections(parsed);
      const resolvedSelections: Record<number, string> = {};
      parsed.forEach((inspection, index) => {
        if (inspection._tag === 'resolved') {
          resolvedSelections[index] = adapterKey(inspection.candidate.adapter);
        }
      });
      setSelections(resolvedSelections);
    } catch (error) {
      setInspections(null);
      setFeedback(
        error instanceof LocalizedIntakeFailure
          ? error.localized
          : i18n.t('imports.intake.malformedResponse'),
      );
    } finally {
      requestInFlight.current = false;
      setRequestState('idle');
    }
  }

  async function continueWithSource(): Promise<void> {
    if (!canContinue || requestInFlight.current) return;
    requestInFlight.current = true;
    setRequestState('executing');
    setFeedback(null);
    try {
      const response = await fetch('/api/source-intake/execute', {
        method: 'POST',
        headers: { 'idempotency-key': submissionKey },
        body: buildPayload(),
      });
      const payload = await readJsonRecord(response);
      if (!response.ok) {
        const failure = parseSourceIntakeFailureEnvelope(payload);
        if (!failure) throw new Error('malformed');
        throw new LocalizedIntakeFailure(sourceIntakeFailureMessage(i18n, failure));
      }

      const redirectTo = typeof payload.redirectTo === 'string' ? payload.redirectTo : '';
      if (
        redirectTo !== '/imports' && !redirectTo.startsWith('/imports/') &&
        !redirectTo.startsWith('/imports?')
      ) {
        throw new Error(i18n.t('imports.intake.malformedResponse'));
      }
      clearStoredSubmissionKey(storageKey);
      // Keep the request guard until navigation replaces this document.
      location.assign(redirectTo);
    } catch (error) {
      setFeedback(
        error instanceof LocalizedIntakeFailure
          ? error.localized
          : i18n.t('imports.intake.malformedResponse'),
      );
      requestInFlight.current = false;
      setRequestState('idle');
    }
  }

  return (
    <div class='grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start'>
      <div class='space-y-6 rounded-lg border border-base-300 bg-base-100 p-5 sm:p-6'>
        {!isRespondusEntry && destination._tag === 'Assessment' && (
          <fieldset class='space-y-3'>
            <legend class='text-base font-medium'>{i18n.t('imports.intake.intentLegend')}</legend>
            <div class='grid gap-3 sm:grid-cols-2'>
              <IntentOption
                name='source-purpose'
                value='recover_existing'
                checked={purpose === 'recover_existing'}
                title={i18n.t('imports.intake.recoverTitle')}
                description={i18n.t('imports.intake.recoverDescription')}
                onChange={() => changePurpose('recover_existing')}
              />
              <IntentOption
                name='source-purpose'
                value='generate_new'
                checked={purpose === 'generate_new'}
                title={i18n.t('imports.intake.generateTitle')}
                description={i18n.t('imports.intake.generateDescription')}
                onChange={() => changePurpose('generate_new')}
              />
            </div>
          </fieldset>
        )}

        <fieldset
          class={[
            'space-y-3',
            isRespondusEntry ? '' : 'border-t border-base-200 pt-5',
          ].join(' ')}
        >
          <legend class='text-base font-medium'>
            {isRespondusEntry
              ? i18n.t('imports.intake.respondusSourceLegend')
              : i18n.t('imports.intake.sourceLegend')}
          </legend>
          <div class='flex flex-wrap gap-5'>
            <label class='flex min-h-12 items-center gap-2 text-sm'>
              <Radio
                name='source-method'
                value='files'
                checked={method === 'files'}
                onChange={() => changeMethod('files')}
              />
              {i18n.t('imports.intake.filesMethod')}
            </label>
            <label class='flex min-h-12 items-center gap-2 text-sm'>
              <Radio
                name='source-method'
                value='paste'
                checked={method === 'paste'}
                onChange={() => changeMethod('paste')}
              />
              {i18n.t('imports.intake.pasteMethod')}
            </label>
          </div>

          {method === 'files'
            ? (
              <FileDropzone
                id='bring-source-files'
                label={isRespondusEntry
                  ? i18n.t('imports.intake.dropRespondus')
                  : i18n.t('imports.intake.dropFiles')}
                help={isRespondusEntry
                  ? i18n.t('imports.intake.respondusFileHelp', {
                    files: MAX_SOURCE_FILES,
                    batchMiB: MAX_SOURCE_BATCH_BYTES / (1024 * 1024),
                  })
                  : purpose === 'recover_existing'
                  ? i18n.t('imports.intake.recoverFileHelp', {
                    files: MAX_SOURCE_FILES,
                    batchMiB: MAX_SOURCE_BATCH_BYTES / (1024 * 1024),
                  })
                  : i18n.t('imports.intake.generateFileHelp', {
                    fileMiB: MAX_GENERATION_FILE_BYTES / (1024 * 1024),
                  })}
                accept={isRespondusEntry
                  ? RESPONDUS_SOURCE_ACCEPT
                  : purpose === 'recover_existing'
                  ? RECOVERY_SOURCE_ACCEPT
                  : GENERATION_SOURCE_ACCEPT}
                files={files}
                formatFileSize={(bytes) => formatSourceFileSize(i18n, bytes)}
                multiple={!isRespondusEntry && purpose === 'recover_existing'}
                disabled={!hydrated || requestState !== 'idle'}
                onFiles={(next) => {
                  setFiles(next);
                  resetInspection({
                    rotateSubmission: !firstFileSelection.current,
                  });
                  firstFileSelection.current = false;
                }}
              />
            )
            : (
              <label class='flex flex-col gap-2'>
                <span class='text-sm font-medium'>{i18n.t('imports.intake.sourceText')}</span>
                <Textarea
                  rows={10}
                  value={text}
                  maxLength={MAX_SOURCE_TEXT_CHARS}
                  placeholder={isRespondusEntry
                    ? i18n.t('imports.intake.pasteRespondusPlaceholder')
                    : purpose === 'recover_existing'
                    ? i18n.t('imports.intake.pasteRecoverPlaceholder')
                    : i18n.t('imports.intake.pasteGeneratePlaceholder')}
                  onInput={(event) => {
                    setText(event.currentTarget.value);
                    resetInspection({ rotateSubmission: true });
                  }}
                  aria-describedby='bring-source-text-help'
                />
                <span id='bring-source-text-help' class='text-xs text-base-content/60'>
                  {i18n.t('imports.intake.characterCount', {
                    count: text.length,
                    limit: MAX_SOURCE_TEXT_CHARS,
                  })}
                </span>
              </label>
            )}
        </fieldset>

        {feedback && (
          <div class='ds-alert ds-alert-error text-sm' role='alert'>
            {feedback}
          </div>
        )}

        {inspections && (
          <section class='space-y-3 border-t border-base-200 pt-5' aria-labelledby='format-heading'>
            <h2 id='format-heading' class='text-base font-medium'>
              {i18n.t('imports.intake.detectedFormat')}
            </h2>
            <div class='space-y-3' aria-live='polite'>
              {inspections.map((inspection, index) => (
                <FormatResult
                  key={`${index}-${inspection._tag}`}
                  inspection={inspection}
                  i18n={i18n}
                  index={index}
                  selected={selections[index]}
                  onSelect={(value) => {
                    setSelections((current) => ({ ...current, [index]: value }));
                    rotateSubmissionKey();
                  }}
                  onSuggestedPurpose={isRespondusEntry ? undefined : changePurpose}
                />
              ))}
            </div>
          </section>
        )}

        <div class='flex flex-wrap items-center gap-3 border-t border-base-200 pt-5'>
          {inspections === null
            ? (
              <Button
                type='button'
                variant='primary'
                disabled={!canInspect || requestState !== 'idle'}
                onClick={uiEvent(inspect)}
              >
                {requestState === 'inspecting'
                  ? i18n.t('imports.intake.checking')
                  : i18n.t('imports.intake.checkSource')}
              </Button>
            )
            : (
              <>
                <Button
                  type='button'
                  variant='primary'
                  disabled={!canContinue || requestState !== 'idle'}
                  onClick={uiEvent(continueWithSource)}
                >
                  {requestState === 'executing'
                    ? i18n.t('imports.intake.preparing')
                    : purpose === 'recover_existing'
                    ? i18n.t('imports.intake.continueReview')
                    : i18n.t('imports.intake.continueGeneration')}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => resetInspection({ rotateSubmission: true })}
                >
                  {i18n.t('imports.intake.checkAgain')}
                </Button>
              </>
            )}
          <Button
            href={destination._tag === 'Assessment'
              ? '/assessments'
              : destination.collectionId === null
              ? '/items'
              : `/items?collection=${destination.collectionId}`}
            variant='ghost'
          >
            {i18n.t('imports.intake.cancel')}
          </Button>
        </div>
      </div>

      <aside class='space-y-4 border-l border-base-300 pl-5 text-sm leading-6 text-base-content/70'>
        {isRespondusEntry
          ? (
            <>
              <div>
                <h2 class='font-medium text-base-content'>
                  {i18n.t('imports.intake.respondusRecovery')}
                </h2>
                <p class='mt-1'>
                  {i18n.t('imports.intake.recoverDescription')}
                </p>
              </div>
              <div>
                <h2 class='font-medium text-base-content'>
                  {i18n.t('imports.intake.canonicalTitle')}
                </h2>
                <p class='mt-1'>
                  {i18n.t('imports.intake.respondusCanonicalDetail')}
                </p>
              </div>
            </>
          )
          : (
            <>
              <div>
                <h2 class='font-medium text-base-content'>
                  {i18n.t('imports.intake.canonicalTitle')}
                </h2>
                <p class='mt-1'>
                  {i18n.t('imports.intake.canonicalDetail')}
                </p>
              </div>
              <div>
                <h2 class='font-medium text-base-content'>
                  {i18n.t('imports.intake.approveResult')}
                </h2>
                <p class='mt-1'>
                  {i18n.t('imports.intake.approvalDetail')}
                </p>
              </div>
              {destination._tag === 'Assessment' && (
                <div class='border-t border-base-300 pt-4'>
                  <p>{i18n.t('imports.intake.blankPrompt')}</p>
                  <NewBlankAssessmentButton i18n={i18n} />
                </div>
              )}
            </>
          )}
      </aside>
    </div>
  );
}

function IntentOption(props: {
  readonly name: string;
  readonly value: SourcePurpose;
  readonly checked: boolean;
  readonly title: string;
  readonly description: string;
  readonly onChange: () => void;
}) {
  return (
    <label
      class={[
        'flex min-h-28 cursor-pointer gap-3 rounded-lg border p-4',
        'focus-within:ring-2 focus-within:ring-primary/30',
        props.checked ? 'border-primary bg-primary/5' : 'border-base-300',
      ].join(' ')}
    >
      <Radio
        name={props.name}
        value={props.value}
        checked={props.checked}
        onChange={props.onChange}
        class='mt-0.5'
      />
      <span>
        <span class='block font-medium text-base-content'>{props.title}</span>
        <span class='mt-1 block text-sm leading-5 text-base-content/65'>{props.description}</span>
      </span>
    </label>
  );
}

function FormatResult(props: {
  readonly inspection: SourceInspection;
  readonly i18n: import('../lib/i18n/messages.ts').I18n;
  readonly index: number;
  readonly selected?: string;
  readonly onSelect: (value: string) => void;
  readonly onSuggestedPurpose?: (purpose: SourcePurpose) => void;
}) {
  const inspection = props.inspection;
  if (inspection._tag === 'resolved') {
    return (
      <div class='rounded-md border border-success/40 bg-success/10 p-3 text-sm'>
        <div class='font-medium text-base-content'>{inspection.sourceName}</div>
        <div class='mt-1 text-base-content/70'>
          {adapterLabel(props.i18n, inspection.candidate.adapter.id, inspection.candidate.label)} ·
          {' '}
          {confidenceLabel(props.i18n, inspection.candidate.confidence)}
        </div>
      </div>
    );
  }
  if (inspection._tag === 'unsupported') {
    return (
      <div class='rounded-md border border-error/40 bg-error/10 p-3 text-sm' role='alert'>
        <div class='font-medium text-base-content'>{inspection.sourceName}</div>
        <p class='mt-1 text-base-content/70'>
          {inspectionReasonMessage(props.i18n, inspection.code ?? 'unsupported_format')}
        </p>
        {inspection.suggestedPurpose && props.onSuggestedPurpose && (
          <Button
            type='button'
            size='sm'
            class='mt-3'
            onClick={() => props.onSuggestedPurpose?.(inspection.suggestedPurpose!)}
          >
            {inspection.suggestedPurpose === 'generate_new'
              ? props.i18n.t('imports.intake.switchGenerate')
              : props.i18n.t('imports.intake.switchRecover')}
          </Button>
        )}
      </div>
    );
  }
  return (
    <fieldset class='rounded-md border border-warning/50 bg-warning/10 p-3'>
      <legend class='px-1 text-sm font-medium text-base-content'>{inspection.sourceName}</legend>
      <p class='text-sm text-base-content/70'>
        {inspectionReasonMessage(props.i18n, inspection.code ?? 'confirmation_required')}
      </p>
      <div class='mt-3 space-y-2'>
        {inspection.candidates.map((candidate) => {
          const value = adapterKey(candidate.adapter);
          return (
            <label class='flex min-h-12 items-center gap-2 text-sm' key={value}>
              <Radio
                name={`format-${props.index}`}
                value={value}
                checked={props.selected === value}
                onChange={() => props.onSelect(value)}
              />
              <span>
                <span class='font-medium text-base-content'>
                  {adapterLabel(props.i18n, candidate.adapter.id, candidate.label)}
                </span>
                <span class='ml-2 text-base-content/60'>
                  {confidenceLabel(props.i18n, candidate.confidence)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function NewBlankAssessmentButton(
  { i18n }: { readonly i18n: import('../lib/i18n/messages.ts').I18n },
) {
  return (
    <form method='post' action='/assessments/new' class='mt-2'>
      <Button type='submit' size='sm'>{i18n.t('imports.intake.blankAction')}</Button>
    </form>
  );
}

function selectedCandidate(
  inspection: SourceInspection,
  selected?: string,
): SourceCandidate | null {
  if (inspection._tag === 'resolved') return inspection.candidate;
  if (inspection._tag !== 'confirmation_required' || !selected) return null;
  return inspection.candidates.find((candidate) => adapterKey(candidate.adapter) === selected) ??
    null;
}

function adapterKey(adapter: SourceAdapterRef): string {
  return `${adapter.id}@${adapter.version}`;
}

function confidenceLabel(i18n: import('../lib/i18n/messages.ts').I18n, confidence: number): string {
  if (confidence >= 0.9) return i18n.t('imports.intake.confidenceHigh');
  if (confidence >= 0.7) return i18n.t('imports.intake.confidenceLikely');
  return i18n.t('imports.intake.confidenceConfirm');
}

function formatSourceFileSize(
  i18n: import('../lib/i18n/messages.ts').I18n,
  bytes: number,
): string {
  if (bytes < 1024) return i18n.t('imports.intake.sizeBytes', { value: bytes });
  const mebibytes = bytes / (1024 * 1024);
  if (mebibytes >= 1) {
    return i18n.t('imports.intake.sizeMiB', {
      value: Math.round(mebibytes * 10) / 10,
    });
  }
  return i18n.t('imports.intake.sizeKiB', {
    value: Math.round(bytes / 102.4) / 10,
  });
}

function readStoredSubmissionKey(storageKey: string): string | null {
  try {
    const value = globalThis.sessionStorage?.getItem(storageKey) ?? '';
    return isCanonicalUuid(value) ? value : null;
  } catch (_cause: unknown) {
    return null;
  }
}

function storeSubmissionKey(storageKey: string, value: string): void {
  try {
    globalThis.sessionStorage?.setItem(storageKey, value);
  } catch (_cause: unknown) {
    // The server still enforces idempotency when browser storage is unavailable.
  }
}

function clearStoredSubmissionKey(storageKey: string): void {
  try {
    globalThis.sessionStorage?.removeItem(storageKey);
  } catch (_cause: unknown) {
    // No browser recovery state exists when session storage is unavailable.
  }
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
