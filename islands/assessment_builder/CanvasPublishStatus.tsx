import { useState } from 'preact/hooks';
import { useI18n } from '../../lib/i18n/context.tsx';

import Button from '../../components/ui/Button.tsx';
import type { CanvasPublishView } from '../../lib/client/canvas_publish.ts';
import type { CanvasPublishClientErrorCode } from '../../lib/client/canvas_publish.ts';

type Props = {
  readonly publish: CanvasPublishView;
  readonly busy: boolean;
  readonly requestFailure: { readonly code: CanvasPublishClientErrorCode } | null;
  readonly onResume: () => void;
  readonly onResolveUnknown: (outcome: 'import-found' | 'import-not-found') => void;
};

/** Renders one explicit durable Canvas phase and its legal author action. */
export default function CanvasPublishStatus(
  { publish, busy, requestFailure, onResume, onResolveUnknown }: Props,
) {
  const i18n = useI18n();
  const [copyState, setCopyState] = useState<'Idle' | 'Copied' | 'Failed'>('Idle');
  const content = requestFailure
    ? {
      heading: i18n.t('delivery.canvas.failedHeading'),
      message: i18n.t('delivery.canvas.failureMessage', { code: requestFailure.code }),
      alertClass: 'ds-alert-error',
    }
    : publishPresentation(publish, i18n);
  const canResume = canResumeCanvasPublish(publish);
  const remote = canvasPublishRemote(publish);
  const failure = canvasPublishFailure(publish);
  const packagePrefix = `qflow-${publish.id}-`;
  const copyPublishId = async () => {
    try {
      await navigator.clipboard.writeText(publish.id);
      setCopyState('Copied');
    } catch (_cause: unknown) {
      setCopyState('Failed');
    }
  };
  return (
    <div
      class={`ds-alert ${content.alertClass}`}
      role={content.alertClass === 'ds-alert-error' ? 'alert' : 'status'}
    >
      <div class='w-full'>
        <div class='font-medium'>{content.heading}</div>
        <p class='mt-1 break-words text-xs text-base-content/70'>
          {publish.connection.name} · {canvasPublishDestinationLabel(publish, i18n)}
        </p>
        <p class='mt-1 text-sm leading-6'>{content.message}</p>
        <div class='mt-2 space-y-1 text-xs text-base-content/75'>
          <p class='break-words'>
            {i18n.t('delivery.canvas.publishId')}{' '}
            <code class='select-all break-all font-mono text-base-content'>{publish.id}</code>
          </p>
          <p class='break-words'>
            {i18n.t('delivery.canvas.packagePrefix')}{' '}
            <code class='select-all break-all font-mono text-base-content'>{packagePrefix}</code>
          </p>
          <div class='flex flex-wrap items-center gap-2'>
            <Button type='button' size='xs' onClick={() => void copyPublishId()}>
              {i18n.t('delivery.canvas.copyId')}
            </Button>
            <span aria-live='polite'>
              {copyState === 'Copied'
                ? i18n.t('delivery.canvas.copied')
                : copyState === 'Failed'
                ? i18n.t('delivery.canvas.copyFailed')
                : ''}
            </span>
          </div>
        </div>
        {remote && (
          <p class='mt-1 font-mono text-xs'>
            {i18n.t('delivery.canvas.migration', { id: remote.contentMigrationId })}
          </p>
        )}
        <div class='mt-3 flex flex-wrap gap-2'>
          {canResume && (
            <Button type='button' size='sm' disabled={busy} onClick={onResume}>
              {resumeLabel(publish, busy, i18n)}
            </Button>
          )}
          {publish.state._tag === 'RemoteIdentityUnknown' && (
            <>
              <Button
                type='button'
                size='sm'
                disabled={busy}
                onClick={() => onResolveUnknown('import-found')}
              >
                {i18n.t('delivery.canvas.importFound')}
              </Button>
              <Button
                type='button'
                size='sm'
                disabled={busy}
                onClick={() => onResolveUnknown('import-not-found')}
              >
                {i18n.t('delivery.canvas.importNotFound')}
              </Button>
            </>
          )}
          <Button href={publish.artifact.packageUrl} size='sm' download>
            {i18n.t('delivery.canvas.downloadPackage')}
          </Button>
          {publish.state._tag === 'Published' && (
            <Button href={publish.state.receiptUrl} size='sm' download>
              {i18n.t('delivery.canvas.downloadReceipt')}
            </Button>
          )}
        </div>
        {failure && <code class='mt-2 block text-xs'>{failure.code}</code>}
      </div>
    </div>
  );
}

function canvasPublishDestinationLabel(
  publish: CanvasPublishView,
  i18n: ReturnType<typeof useI18n>,
): string {
  if (publish.destination._tag === 'Course') {
    return i18n.t('delivery.canvas.course', { id: publish.destination.courseId });
  }
  const bank = publish.destination.bank;
  const bankLabel = bank._tag === 'Existing'
    ? i18n.t('delivery.canvas.existingBank', { id: bank.questionBankId })
    : i18n.t('delivery.canvas.newBank', { name: bank.questionBankName });
  return i18n.t('delivery.canvas.courseDestination', {
    course: publish.destination.courseId,
    bank: bankLabel,
  });
}

function resumeLabel(
  publish: CanvasPublishView,
  busy: boolean,
  i18n: ReturnType<typeof useI18n>,
): string {
  if (busy) return i18n.t('delivery.canvas.checking');
  return publish.state._tag === 'RetryCreate' ||
      publish.state._tag === 'RetryUpload' ||
      publish.state._tag === 'RetryObserve'
    ? i18n.t('delivery.canvas.retry')
    : i18n.t('delivery.canvas.checkStatus');
}

function publishPresentation(publish: CanvasPublishView, i18n: ReturnType<typeof useI18n>): {
  readonly heading: string;
  readonly message: string;
  readonly alertClass: string;
} {
  switch (publish.state._tag) {
    case 'Prepared':
      return {
        heading: i18n.t('delivery.canvas.packagePreserved'),
        message: i18n.t('delivery.canvas.preparedMessage'),
        alertClass: 'ds-alert-info',
      };
    case 'ClaimingCreate':
    case 'Creating':
    case 'Uploading':
    case 'Observing':
      return {
        heading: i18n.t('delivery.canvas.sending'),
        message: i18n.t('delivery.canvas.sendingMessage'),
        alertClass: 'ds-alert-info',
      };
    case 'Processing':
      return {
        heading: i18n.t('delivery.canvas.processing'),
        message: i18n.t('delivery.canvas.processingMessage'),
        alertClass: 'ds-alert-info',
      };
    case 'Published':
      return {
        heading: i18n.t('delivery.canvas.published'),
        message: i18n.t('delivery.canvas.publishedMessage'),
        alertClass: 'ds-alert-success',
      };
    case 'RetryCreate':
    case 'RetryUpload':
    case 'RetryObserve':
      return {
        heading: i18n.t('delivery.canvas.retryHeading'),
        message: i18n.t('delivery.canvas.failureMessage', { code: publish.state.failure.code }),
        alertClass: 'ds-alert-error',
      };
    case 'RemoteIdentityUnknown':
      return {
        heading: i18n.t('delivery.canvas.unknownHeading'),
        message: i18n.t('delivery.canvas.failureMessage', { code: publish.state.failure.code }),
        alertClass: 'ds-alert-error',
      };
    case 'RemoteIdentityResolved':
      return {
        heading: i18n.t('delivery.canvas.resolvedHeading'),
        message: publish.state.outcome === 'import-found'
          ? i18n.t('delivery.canvas.importRecorded')
          : i18n.t('delivery.canvas.importNotRecorded'),
        alertClass: 'ds-alert-info',
      };
    case 'Failed':
      return {
        heading: i18n.t('delivery.canvas.failedHeading'),
        message: i18n.t('delivery.canvas.failureMessage', { code: publish.state.failure.code }),
        alertClass: 'ds-alert-error',
      };
  }
}

function canResumeCanvasPublish(publish: CanvasPublishView): boolean {
  return publish.state._tag === 'Prepared' ||
    publish.state._tag === 'ClaimingCreate' ||
    publish.state._tag === 'Creating' ||
    publish.state._tag === 'Uploading' ||
    publish.state._tag === 'Observing' ||
    publish.state._tag === 'Processing' ||
    publish.state._tag === 'RetryCreate' ||
    publish.state._tag === 'RetryUpload' ||
    publish.state._tag === 'RetryObserve';
}

function canvasPublishRemote(publish: CanvasPublishView) {
  switch (publish.state._tag) {
    case 'Uploading':
    case 'Observing':
    case 'Processing':
    case 'RetryUpload':
    case 'RetryObserve':
    case 'Published':
      return publish.state.remote;
    case 'Failed':
      return publish.state.remote;
    default:
      return null;
  }
}

function canvasPublishFailure(publish: CanvasPublishView) {
  switch (publish.state._tag) {
    case 'RetryCreate':
    case 'RetryUpload':
    case 'RetryObserve':
    case 'RemoteIdentityUnknown':
    case 'RemoteIdentityResolved':
    case 'Failed':
      return publish.state.failure;
    default:
      return null;
  }
}
