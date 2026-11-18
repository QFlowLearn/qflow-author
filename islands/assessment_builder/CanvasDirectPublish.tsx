import { reportUiError } from '../../lib/client/ui_event.ts';
import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';
import type { JSX } from 'preact';

import Button from '../../components/ui/Button.tsx';
import Input from '../../components/ui/Input.tsx';
import Radio from '../../components/ui/Radio.tsx';
import Select from '../../components/ui/Select.tsx';
import type { AssessmentExportSelection } from '../../lib/client/assessment_export_workflow.ts';
import type {
  CanvasPublishDestinationInput,
  CanvasPublishView,
} from '../../lib/client/canvas_publish.ts';
import type { AssessmentExportPreflightView } from '../../lib/export/assessment_export_preflight_client.ts';
import type { CanvasPublishTargetId } from '../../lib/lms/canvas_connection_types.ts';
import CanvasPublishHistory from './CanvasPublishHistory.tsx';
import { useCanvasPublish } from './useCanvasPublish.ts';

type Props = {
  readonly assessmentId: string;
  readonly selection: AssessmentExportSelection & { readonly targetId: CanvasPublishTargetId };
  readonly preflight: Extract<AssessmentExportPreflightView, { readonly _tag: 'Evaluated' }>;
};

type DestinationChoice = 'course' | 'existing-bank' | 'new-bank';

export default function CanvasDirectPublish({ assessmentId, selection, preflight }: Props) {
  const i18n = useI18n();
  const {
    connectionsState,
    publishesState,
    publishState,
    send,
    resume,
    resolveUnknown,
    beginNewIntent,
    reloadPublishes,
    loadMoreTerminal,
    busy,
  } = useCanvasPublish({ assessmentId, selection, preflight });
  const [publishId, setPublishId] = useState(() => crypto.randomUUID());
  const [connectionId, setConnectionId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [destinationChoice, setDestinationChoice] = useState<DestinationChoice>('course');
  const [questionBankId, setQuestionBankId] = useState('');
  const [questionBankName, setQuestionBankName] = useState('');

  useEffect(() => setPublishId(crypto.randomUUID()), [
    assessmentId,
    preflight.preflightId,
    selection.targetId,
  ]);

  const revisePublishIntent = (update: () => void) => {
    beginNewIntent();
    setPublishId(crypto.randomUUID());
    update();
  };

  const startAnotherPublish = () => {
    beginNewIntent();
    setPublishId(crypto.randomUUID());
  };

  const currentPublish = [
    ...publishesState.actionRequired,
    ...publishesState.terminal,
  ].find((publish) => publish.id === publishId) ??
    (publishState._tag === 'Resolved' && publishState.publish.id === publishId
      ? publishState.publish
      : null);
  const currentIntentCommitted = currentPublish !== null;

  const submit = (event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const destination = destinationInput(
      selection.targetId,
      destinationChoice,
      courseId,
      questionBankId,
      questionBankName,
    );
    if (destination === null) return;
    const command = {
      publishId,
      connectionId,
      destination,
    };
    send(command).catch(reportUiError);
  };

  const history = (
    <CanvasPublishHistory
      state={publishesState}
      publishState={publishState}
      busy={busy}
      onResume={(publish) => void resume(publish)}
      onResolveUnknown={(publish, outcome) => void resolveUnknown(publish, outcome)}
      onReload={() => void reloadPublishes()}
      onLoadMore={() => void loadMoreTerminal()}
    />
  );

  if (connectionsState._tag === 'Loading') {
    return (
      <div
        class='border-t border-base-300 pt-5'
        aria-label={i18n.t('delivery.canvas.loadingConnections')}
      >
        <div class='ds-skeleton h-5 w-52' />
        <div class='mt-3 ds-skeleton h-20 w-full max-w-2xl' />
        {history}
      </div>
    );
  }
  if (connectionsState._tag === 'Failed') {
    return (
      <div class='border-t border-base-300 pt-5'>
        <h3 class='text-sm font-semibold text-base-content'>{i18n.t('delivery.canvas.title')}</h3>
        <div class='mt-3 ds-alert ds-alert-error' role='alert'>
          <span>
            {i18n.t('delivery.canvas.connectionsFailed', { code: connectionsState.code })}
          </span>
        </div>
        {history}
      </div>
    );
  }
  if (connectionsState.connections.length === 0) {
    return (
      <div class='border-t border-base-300 pt-5'>
        <h3 class='text-sm font-semibold text-base-content'>{i18n.t('delivery.canvas.title')}</h3>
        <p class='mt-1 max-w-2xl text-sm leading-6 text-base-content/70'>
          {i18n.t('delivery.canvas.setupDescription')}
        </p>
        <Button class='mt-3' size='sm' href='/settings/canvas'>
          {i18n.t('delivery.canvas.setup')}
        </Button>
        {history}
      </div>
    );
  }

  return (
    <div class='border-t border-base-300 pt-5'>
      <form
        action={`/api/assessments/${encodeURIComponent(assessmentId)}/publish/canvas`}
        method='post'
        onSubmit={submit}
        class='max-w-2xl'
      >
        <input type='hidden' name='publishId' value={publishId} />
        <input type='hidden' name='targetId' value={selection.targetId} />
        <input type='hidden' name='preflightId' value={preflight.preflightId} />
        <input
          type='hidden'
          name='acknowledgement'
          value={preflight.acknowledgementToken ?? ''}
        />
        <input type='hidden' name='scoring' value={selection.requirements.scoring} />
        <input type='hidden' name='interaction' value={selection.requirements.interaction} />
        {selection.targetId === 'canvas-new-quizzes' && (
          <input type='hidden' name='destinationChoice' value='course' />
        )}
        <fieldset disabled={busy || currentIntentCommitted} class='space-y-4'>
          <legend class='text-sm font-semibold text-base-content'>
            {i18n.t('delivery.canvas.title')}
          </legend>
          <p class='text-sm leading-6 text-base-content/70'>
            {i18n.t('delivery.canvas.formDescription')}
          </p>

          <div>
            <label for='canvas-publish-connection' class='text-sm font-medium text-base-content'>
              {i18n.t('delivery.canvas.connectionLabel')}
            </label>
            <p id='canvas-publish-connection-hint' class='mb-2 mt-1 text-xs text-base-content/65'>
              {i18n.t('delivery.canvas.connectionHint')}
            </p>
            <Select
              id='canvas-publish-connection'
              name='connectionId'
              required
              value={connectionId}
              aria-describedby='canvas-publish-connection-hint'
              onChange={(event) =>
                revisePublishIntent(() => setConnectionId(event.currentTarget.value))}
            >
              <option value=''>{i18n.t('delivery.canvas.chooseConnection')}</option>
              {connectionsState.connections.map((connection) => (
                <option value={connection.id} key={connection.id}>
                  {connection.name} · {new URL(connection.baseUrl).hostname}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label for='canvas-publish-course-id' class='text-sm font-medium text-base-content'>
              {i18n.t('delivery.canvas.courseLabel')}
            </label>
            <p id='canvas-publish-course-id-hint' class='mb-2 mt-1 text-xs text-base-content/65'>
              {i18n.t('delivery.canvas.courseHint')} <code>sis_course_id:BIO.101-2026</code>.
            </p>
            <Input
              id='canvas-publish-course-id'
              name='courseId'
              value={courseId}
              required
              maxLength={255}
              autoComplete='off'
              spellcheck={false}
              aria-describedby='canvas-publish-course-id-hint'
              onInput={(event) => revisePublishIntent(() => setCourseId(event.currentTarget.value))}
            />
          </div>

          {selection.targetId === 'canvas-classic' && (
            <fieldset>
              <legend class='text-sm font-medium text-base-content'>
                {i18n.t('delivery.canvas.destinationLabel')}
              </legend>
              <div class='mt-2 space-y-2'>
                <DestinationRadio
                  value='course'
                  checked={destinationChoice === 'course'}
                  label={i18n.t('delivery.canvas.courseOption')}
                  onChange={(value) => revisePublishIntent(() => setDestinationChoice(value))}
                />
                <DestinationRadio
                  value='existing-bank'
                  checked={destinationChoice === 'existing-bank'}
                  label={i18n.t('delivery.canvas.existingBankOption')}
                  onChange={(value) => revisePublishIntent(() => setDestinationChoice(value))}
                />
                <DestinationRadio
                  value='new-bank'
                  checked={destinationChoice === 'new-bank'}
                  label={i18n.t('delivery.canvas.newBankOption')}
                  onChange={(value) => revisePublishIntent(() => setDestinationChoice(value))}
                />
              </div>
            </fieldset>
          )}

          {selection.targetId === 'canvas-classic' && destinationChoice === 'existing-bank' && (
            <div>
              <label for='canvas-publish-bank-id' class='text-sm font-medium text-base-content'>
                {i18n.t('delivery.canvas.bankIdLabel')}
              </label>
              <Input
                id='canvas-publish-bank-id'
                name='questionBankId'
                value={questionBankId}
                required
                inputMode='numeric'
                pattern='[0-9]+'
                maxLength={30}
                autoComplete='off'
                onInput={(event) =>
                  revisePublishIntent(() => setQuestionBankId(event.currentTarget.value))}
              />
            </div>
          )}

          {selection.targetId === 'canvas-classic' && destinationChoice === 'new-bank' && (
            <div>
              <label for='canvas-publish-bank-name' class='text-sm font-medium text-base-content'>
                {i18n.t('delivery.canvas.bankNameLabel')}
              </label>
              <Input
                id='canvas-publish-bank-name'
                name='questionBankName'
                value={questionBankName}
                required
                maxLength={255}
                autoComplete='off'
                onInput={(event) =>
                  revisePublishIntent(() => setQuestionBankName(event.currentTarget.value))}
              />
            </div>
          )}

          {selection.targetId === 'canvas-new-quizzes' && (
            <p class='text-xs leading-5 text-base-content/65'>
              {i18n.t('delivery.canvas.newQuizzesNote')}
            </p>
          )}

          {!currentIntentCommitted && (
            <Button type='submit' variant='primary' disabled={busy}>
              {publishState._tag === 'Submitting' ? i18n.t('delivery.canvas.submitting') : i18n.t(
                preflight.overallOutcome === 'warning'
                  ? 'delivery.canvas.publishWithChanges'
                  : 'delivery.canvas.publish',
              )}
            </Button>
          )}
        </fieldset>
      </form>

      {currentPublish && isClosedCanvasPublish(currentPublish) && (
        <div class='mt-3 max-w-2xl'>
          <Button type='button' variant='primary' disabled={busy} onClick={startAnotherPublish}>
            {i18n.t('delivery.canvas.startAnother')}
          </Button>
        </div>
      )}
      {currentPublish && !isClosedCanvasPublish(currentPublish) && (
        <p class='mt-3 max-w-2xl text-sm leading-6 text-base-content/70'>
          {i18n.t('delivery.canvas.continue')}
        </p>
      )}

      <div class='mt-4 max-w-2xl' aria-live='polite' aria-atomic='true'>
        {publishState._tag === 'RequestFailed' && publishState.command.publishId === publishId && (
          <div class='ds-alert ds-alert-error' role='alert'>
            <div>
              <div class='font-medium'>{i18n.t('delivery.canvas.requestFailedHeading')}</div>
              <p class='mt-1 text-sm'>
                {i18n.t('delivery.canvas.failureMessage', { code: publishState.code })}
              </p>
              <Button
                type='button'
                size='sm'
                class='mt-3'
                onClick={() => void send(publishState.command)}
              >
                {i18n.t('delivery.canvas.retryRequest')}
              </Button>
            </div>
          </div>
        )}
      </div>
      {history}
    </div>
  );
}

function DestinationRadio(
  { value, checked, label, onChange }: {
    readonly value: DestinationChoice;
    readonly checked: boolean;
    readonly label: string;
    readonly onChange: (value: DestinationChoice) => void;
  },
) {
  const id = `canvas-publish-destination-${value}`;
  return (
    <label for={id} class='flex min-h-12 cursor-pointer items-center gap-3 text-sm'>
      <Radio
        id={id}
        name='destinationChoice'
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span>{label}</span>
    </label>
  );
}

function destinationInput(
  targetId: CanvasPublishTargetId,
  choice: DestinationChoice,
  courseId: string,
  questionBankId: string,
  questionBankName: string,
): CanvasPublishDestinationInput | null {
  if (targetId === 'canvas-new-quizzes' || choice === 'course') {
    return { type: 'course', courseId };
  }
  if (choice === 'existing-bank' && questionBankId.length > 0) {
    return { type: 'question-bank', courseId, questionBankId };
  }
  if (choice === 'new-bank' && questionBankName.trim().length > 0) {
    return { type: 'question-bank', courseId, questionBankName: questionBankName.trim() };
  }
  return null;
}

function isClosedCanvasPublish(
  publish: CanvasPublishView,
): boolean {
  return publish.state._tag === 'Published' || publish.state._tag === 'Failed' ||
    publish.state._tag === 'RemoteIdentityResolved';
}
