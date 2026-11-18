import { reportUiError } from '../../lib/client/ui_event.ts';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import ActionNotice from '../ui/ActionNotice.tsx';
import Button from '../ui/Button.tsx';
import type { I18n } from '../../lib/i18n/messages.ts';
import type { PlacementRecoveryClientFailure } from '../../lib/client/assessment_placement_recovery.ts';
import type { useAssessmentPlacementRecovery } from './useAssessmentPlacementRecovery.ts';

/** Keep saved-removal recovery reachable without hijacking another question's native undo. */
export default function AssessmentPlacementRecoveryNotice(props: {
  readonly recovery: ReturnType<typeof useAssessmentPlacementRecovery>;
  readonly busy: boolean;
  readonly i18n: I18n;
  readonly onReload: () => void;
}) {
  const { recovery, i18n, busy } = props;
  const { notice } = recovery;
  const [expired, setExpired] = useState(false);
  const expiresAt = notice?._tag === 'Pending' ? notice.receipt.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) {
      setExpired(false);
      return;
    }
    const delay = Date.parse(expiresAt) - Date.now();
    setExpired(delay <= 0);
    const timer = setTimeout(() => setExpired(true), Math.max(0, delay));
    return () => clearTimeout(timer);
  }, [expiresAt]);
  useLayoutEffect(() => {
    const primary = document.getElementById('assessment-removal-primary');
    if (recovery.focusRequest > 0 && primary instanceof HTMLButtonElement) {
      primary.focus();
    }
  }, [recovery.focusRequest]);
  function dismiss() {
    recovery.dismiss();
    const target = document.querySelector('[data-authoring-tools] button');
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }
  const announcement = expired && notice?._tag === 'Pending'
    ? i18n.t('assessments.builder.recoveryExpired')
    : recovery.announcement
    ? i18n.t(
      recovery.announcement._tag === 'Removed'
        ? 'assessments.builder.recoveryRemoved'
        : 'assessments.builder.recoveryRestored',
      {
        title: recovery.announcement.title,
      },
    )
    : '';
  const failure = notice && 'failure' in notice ? notice.failure : undefined;
  const terminal = failure === 'expired' || failure === 'forbidden' || failure === 'not_found' ||
    failure === 'unavailable' || failure === 'adaptive_managed';
  let message = '', detail: string | undefined;
  if (notice) {
    switch (notice._tag) {
      case 'Pending':
        message = i18n.t('assessments.builder.recoveryRemoved', { title: notice.receipt.title });
        detail = notice.failure === 'expired'
          ? undefined
          : expired
          ? i18n.t('assessments.builder.recoveryExpired')
          : i18n.t('assessments.builder.recoveryWindow');
        break;
      case 'Restored':
        message = i18n.t('assessments.builder.recoveryRestored', { title: notice.receipt.title });
        break;
      case 'ReloadRequired':
        message = i18n.t('assessments.builder.recoveryRestored', { title: notice.receipt.title });
        detail = i18n.t('assessments.builder.recoveryReloadRequired');
        break;
      case 'HistoryFailed':
        message = i18n.t('assessments.builder.recoveryHistoryFailed');
        break;
      case 'RemoveFailed':
        message = i18n.t('assessments.builder.recoveryRemoveFailed');
        break;
    }
  }
  return (
    <>
      <p class='sr-only' role='status' aria-atomic='true'>{announcement}</p>
      {notice && (
        <ActionNotice
          id='assessment-removal-notice'
          label={i18n.t('assessments.builder.recoveryLabel')}
          message={message}
          detail={detail}
          error={failure ? failureMessage(i18n, failure) : undefined}
        >
          <Button
            type='button'
            id='assessment-removal-primary'
            aria-describedby={failure
              ? 'assessment-removal-notice-error'
              : notice._tag === 'Pending'
              ? 'assessment-removal-notice-detail'
              : undefined}
            aria-disabled={busy || (notice._tag === 'Pending' && (expired || terminal))}
            onClick={() => {
              if (busy) return;
              if (notice._tag === 'Pending') {
                if (!expired && !terminal) recovery.restore(notice.receipt).catch(reportUiError);
              } else if (notice._tag === 'HistoryFailed') {
                recovery.retryHistory().catch(reportUiError);
              } else dismiss();
            }}
          >
            {notice._tag === 'Pending'
              ? i18n.t('assessments.builder.recoveryUndo')
              : notice._tag === 'HistoryFailed'
              ? i18n.t('assessments.builder.recoveryRetry')
              : i18n.t('assessments.builder.recoveryDismiss')}
          </Button>
          {(notice._tag === 'ReloadRequired' || notice._tag === 'RemoveFailed' || failure) &&
            (
              <Button type='button' disabled={busy} onClick={props.onReload}>
                {i18n.t('assessments.builder.recoveryReload')}
              </Button>
            )}
          {(notice._tag === 'Pending' || notice._tag === 'HistoryFailed') &&
            (
              <Button type='button' variant='ghost' disabled={busy} onClick={dismiss}>
                {i18n.t('assessments.builder.recoveryDismiss')}
              </Button>
            )}
        </ActionNotice>
      )}
    </>
  );
}

function failureMessage(i18n: I18n, failure: PlacementRecoveryClientFailure): string {
  switch (failure) {
    case 'expired':
      return i18n.t('assessments.builder.recoveryExpired');
    case 'conflict':
      return i18n.t('assessments.builder.recoveryConflict');
    case 'unavailable':
    case 'not_found':
      return i18n.t('assessments.builder.recoveryUnavailable');
    case 'forbidden':
      return i18n.t('assessments.builder.recoveryForbidden');
    case 'adaptive_managed':
      return i18n.t('assessments.builder.recoveryAdaptive');
    case 'storage_failed':
      return i18n.t('assessments.builder.recoveryStoreFailed');
    case 'request_failed':
    case 'invalid_response':
      return i18n.t('assessments.builder.recoveryUncertain');
  }
}
